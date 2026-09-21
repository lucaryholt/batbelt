use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::NewWindowResponse;
use tauri::{
    ActivationPolicy, AppHandle, Manager, PhysicalPosition, RunEvent, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

/// Menu bar artwork, derived from icons/icon.png with the white knockout
/// removed so the alpha channel carries the logo. A template image is drawn
/// from alpha alone, so the bundle icon (whose alpha is a filled oval) renders
/// as a solid blob.
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray.png");

const WINDOW_LABEL: &str = "main";
const POPOVER_W: f64 = 1080.0;
const POPOVER_H: f64 = 800.0;
const POPOVER_TOP_MARGIN: f64 = 8.0;
const POPOVER_MIN_W: f64 = 480.0;
const POPOVER_MIN_H: f64 = 400.0;
const PORT_MIN: u16 = 3870;
const PORT_MAX: u16 = 3879;

struct DesktopState {
    child: Option<Child>,
    attached: bool,
    url: Option<String>,
    ignore_blur_until: Instant,
}

impl DesktopState {
    fn new() -> Self {
        Self {
            child: None,
            attached: true,
            url: None,
            ignore_blur_until: Instant::now(),
        }
    }
}

fn log_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let dir = PathBuf::from(home).join("Library").join("Logs");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("batbelt-desktop.log"))
}

fn open_log() -> Option<std::fs::File> {
    let path = log_path()?;
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .ok()
}

fn log_line(msg: &str) {
    eprintln!("batbelt: {msg}");
    if let Some(mut file) = open_log() {
        let _ = writeln!(file, "{msg}");
    }
}

fn set_status(app: &AppHandle, text: &str) {
    let Some(win) = main_window(app) else {
        return;
    };
    let payload = serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_string());
    let js = format!(
        "(function(){{var el=document.getElementById('status');if(el)el.textContent={payload};}})()"
    );
    let _ = win.eval(&js);
}

/// Surfaces a launcher failure in the splash window; stderr is invisible when
/// the bundle is started from Finder.
fn report_failure(app: &AppHandle, msg: String) {
    log_line(&msg);
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(600));
        set_status(&app, &msg);
        show_attached_popover(&app);
    });
}

fn login_shell_path() -> String {
    let from_shell = Command::new("zsh")
        .args(["-ilc", "printenv PATH"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let mut path = from_shell.unwrap_or_else(|| std::env::var("PATH").unwrap_or_default());

    // Fallbacks for GUI launches that start with a bare PATH. These are
    // appended, never prepended: the login shell's own node must win, or
    // native modules such as better-sqlite3 are loaded by a Node version they
    // were not compiled against.
    let mut extras: Vec<String> = vec![
        "/opt/homebrew/bin".into(),
        "/usr/local/bin".into(),
        "/usr/bin".into(),
    ];
    if let Ok(home) = std::env::var("HOME") {
        if let Some(bin) = newest_nvm_bin(&home) {
            extras.push(bin.to_string_lossy().into_owned());
        }
    }

    for extra in extras {
        if Path::new(&extra).is_dir() && !path.split(':').any(|p| p == extra) {
            path = format!("{path}:{extra}");
        }
    }
    path
}

fn newest_nvm_bin(home: &str) -> Option<PathBuf> {
    let nvm = PathBuf::from(home).join(".nvm/versions/node");
    let mut versions: Vec<(Vec<u32>, PathBuf)> = std::fs::read_dir(nvm)
        .ok()?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let bin = entry.path().join("bin");
            if !bin.is_dir() {
                return None;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let parts = name
                .trim_start_matches('v')
                .split('.')
                .map(|part| part.parse::<u32>().unwrap_or(0))
                .collect();
            Some((parts, bin))
        })
        .collect();
    versions.sort();
    versions.pop().map(|(_, bin)| bin)
}

fn which_in_path(name: &str, path: &str) -> Option<PathBuf> {
    for dir in path.split(':') {
        let candidate = PathBuf::from(dir).join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn app_root(app: &AppHandle) -> PathBuf {
    if let Ok(home) = std::env::var("BATBELT_HOME") {
        return PathBuf::from(home);
    }
    if let Ok(res) = app.path().resource_dir() {
        let nested = res.join("batbelt");
        if nested.join("dist").join("cli.js").is_file() {
            return nested;
        }
    }
    if let Ok(mut dir) = std::env::current_dir() {
        for _ in 0..10 {
            if dir.join("dist").join("cli.js").is_file() || dir.join("package.json").is_file() {
                return dir;
            }
            if !dir.pop() {
                break;
            }
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn health_ok(port: u16) -> bool {
    let addr: SocketAddr = match format!("127.0.0.1:{port}").parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(250)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(400)));
    if stream
        .write_all(b"GET /api/health HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut buf = String::new();
    let _ = stream.read_to_string(&mut buf);
    buf.contains("\"ok\"") && buf.contains("batbelt")
}

fn find_running_port() -> Option<u16> {
    (PORT_MIN..=PORT_MAX).find(|p| health_ok(*p))
}

fn is_loopback(parsed: &url::Url) -> bool {
    matches!(parsed.host_str(), Some("127.0.0.1") | Some("localhost") | Some("::1"))
}

fn should_stay_in_webview(raw: &str) -> bool {
    match url::Url::parse(raw) {
        Ok(u) => {
            if u.scheme() == "tauri" || u.scheme() == "asset" || raw.starts_with("tauri://") {
                return true;
            }
            if u.host_str().is_none() && (u.scheme() == "http" || u.scheme() == "https") {
                return false;
            }
            is_loopback(&u) && u.port_or_known_default() != Some(8250)
        }
        Err(_) => raw.starts_with("tauri:") || raw.starts_with("asset:"),
    }
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW_LABEL)
}

fn mark_ignore_blur(app: &AppHandle) {
    if let Ok(mut st) = app.state::<Mutex<DesktopState>>().lock() {
        st.ignore_blur_until = Instant::now() + Duration::from_millis(450);
    }
}

/// Anchors the popover to the top centre of the active screen, just under the
/// menu bar, regardless of where the tray icon sits.
fn position_top_center(win: &WebviewWindow) {
    let monitor = match win.current_monitor() {
        Ok(Some(monitor)) => monitor,
        _ => match win.primary_monitor() {
            Ok(Some(monitor)) => monitor,
            _ => return,
        },
    };
    let Ok(size) = win.outer_size() else {
        return;
    };
    let area = monitor.work_area();
    let margin = (POPOVER_TOP_MARGIN * monitor.scale_factor()).round() as i32;
    let x = area.position.x + (area.size.width as i32 - size.width as i32) / 2;
    let y = area.position.y + margin;
    let _ = win.set_position(PhysicalPosition::new(x, y));
}

fn show_attached_popover(app: &AppHandle) {
    let Some(win) = main_window(app) else {
        return;
    };
    mark_ignore_blur(app);
    position_top_center(&win);
    let _ = win.show();
    let _ = win.set_focus();
}

fn hide_window(app: &AppHandle) {
    if let Some(win) = main_window(app) {
        let _ = win.hide();
    }
}

fn is_attached(app: &AppHandle) -> bool {
    app.state::<Mutex<DesktopState>>()
        .lock()
        .map(|s| s.attached)
        .unwrap_or(true)
}

fn toggle_popover(app: &AppHandle) {
    let Some(win) = main_window(app) else {
        return;
    };
    let attached = is_attached(app);
    let visible = win.is_visible().unwrap_or(false);
    if !attached {
        mark_ignore_blur(app);
        let _ = win.show();
        let _ = win.set_focus();
        #[cfg(target_os = "macos")]
        let _ = app.set_activation_policy(ActivationPolicy::Regular);
        return;
    }
    if visible {
        hide_window(app);
    } else {
        show_attached_popover(app);
    }
}

fn pop_out(app: &AppHandle) {
    let Some(win) = main_window(app) else {
        return;
    };
    if let Ok(mut st) = app.state::<Mutex<DesktopState>>().lock() {
        st.attached = false;
        st.ignore_blur_until = Instant::now() + Duration::from_secs(2);
    }
    let _ = win.set_always_on_top(false);
    let _ = win.set_skip_taskbar(false);
    let _ = win.set_decorations(true);
    let _ = win.set_resizable(true);
    let _ = win.set_title("batbelt");
    let _ = win.show();
    let _ = win.set_focus();
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(ActivationPolicy::Regular);
}

fn return_to_menubar(app: &AppHandle) {
    let Some(win) = main_window(app) else {
        return;
    };
    if let Ok(mut st) = app.state::<Mutex<DesktopState>>().lock() {
        st.attached = true;
        st.ignore_blur_until = Instant::now() + Duration::from_millis(450);
    }
    let _ = win.set_resizable(true);
    let _ = win.set_decorations(false);
    let _ = win.set_always_on_top(true);
    let _ = win.set_skip_taskbar(true);
    let _ = win.set_size(tauri::LogicalSize::new(POPOVER_W, POPOVER_H));
    let _ = win.hide();
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(ActivationPolicy::Accessory);
}

fn open_in_browser(app: &AppHandle) {
    let url = app
        .state::<Mutex<DesktopState>>()
        .lock()
        .ok()
        .and_then(|s| s.url.clone())
        .unwrap_or_else(|| format!("http://127.0.0.1:{PORT_MIN}"));
    let _ = open::that(url);
}

fn stop_child(app: &AppHandle) {
    if let Ok(mut st) = app.state::<Mutex<DesktopState>>().lock() {
        if let Some(child) = st.child.as_mut() {
            let pid = child.id() as i32;
            unsafe {
                libc::kill(pid, libc::SIGTERM);
            }
            let _ = child.wait();
        }
        st.child = None;
    }
}

fn spawn_server(app: &AppHandle) -> Result<u16, String> {
    if let Some(port) = find_running_port() {
        log_line(&format!("attaching to existing server on port {port}"));
        return Ok(port);
    }
    let path = login_shell_path();
    let node = which_in_path("node", &path).ok_or_else(|| {
        "node was not found on PATH. Install Node.js 20+ and the Homebrew/nvm binaries.".to_string()
    })?;
    let root = app_root(app);
    let cli = root.join("dist").join("cli.js");
    if !cli.is_file() {
        return Err(format!(
            "Frontend/server build not found at {}. Run `npm run build` first.",
            cli.display()
        ));
    }
    let port = (PORT_MIN..=PORT_MAX)
        .find(|p| {
            TcpStream::connect_timeout(
                &format!("127.0.0.1:{p}").parse().unwrap(),
                Duration::from_millis(80),
            )
            .is_err()
        })
        .ok_or_else(|| "No free port in 3870–3879".to_string())?;

    log_line(&format!(
        "starting {} {} --port {port} (cwd {})",
        node.display(),
        cli.display(),
        root.display()
    ));

    let mut cmd = Command::new(&node);
    cmd.arg(&cli)
        .arg("--port")
        .arg(port.to_string())
        .env("PATH", &path)
        .env("BATBELT_DESKTOP", "1")
        .env("DEV", "0")
        .current_dir(&root)
        .stdin(Stdio::null())
        .stdout(open_log().map(Stdio::from).unwrap_or_else(Stdio::null))
        .stderr(open_log().map(Stdio::from).unwrap_or_else(Stdio::null));
    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start node {}: {e}", node.display()))?;
    if let Ok(mut st) = app.state::<Mutex<DesktopState>>().lock() {
        st.child = Some(child);
    }
    Ok(port)
}

fn wait_and_navigate(app: AppHandle, port: u16) {
    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(20);
        while Instant::now() < deadline {
            if health_ok(port) {
                let url = format!("http://127.0.0.1:{port}/");
                if let Ok(mut st) = app.state::<Mutex<DesktopState>>().lock() {
                    st.url = Some(url.clone());
                }
                if let Some(win) = main_window(&app) {
                    if let Ok(parsed) = url::Url::parse(&url) {
                        let _ = win.navigate(parsed);
                    }
                }
                log_line(&format!("serving {url}"));
                return;
            }

            let exited = {
                let state = app.state::<Mutex<DesktopState>>();
                let status = match state.lock() {
                    Ok(mut guard) => guard
                        .child
                        .as_mut()
                        .and_then(|child| child.try_wait().ok().flatten()),
                    Err(_) => None,
                };
                status
            };
            if let Some(status) = exited {
                report_failure(
                    &app,
                    format!("The batbelt server exited ({status}). See ~/Library/Logs/batbelt-desktop.log"),
                );
                return;
            }

            std::thread::sleep(Duration::from_millis(200));
        }
        report_failure(
            &app,
            format!("The batbelt server never became healthy on port {port}. See ~/Library/Logs/batbelt-desktop.log"),
        );
    });
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let open = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
    let pop = MenuItem::with_id(app, "popout", "Pop out", true, None::<&str>)?;
    let browser = MenuItem::with_id(app, "browser", "Open in browser", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    Menu::with_items(app, &[&open, &pop, &browser, &sep, &quit])
}

fn handle_menu(app: &AppHandle, id: &str) {
    match id {
        "open" => toggle_popover(app),
        "popout" => pop_out(app),
        "browser" => open_in_browser(app),
        "quit" => {
            stop_child(app);
            app.exit(0);
        }
        _ => {}
    }
}

fn create_main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::App("index.html".into()))
        .title("batbelt")
        .inner_size(POPOVER_W, POPOVER_H)
        .min_inner_size(POPOVER_MIN_W, POPOVER_MIN_H)
        .visible(false)
        .decorations(false)
        .resizable(true)
        .skip_taskbar(true)
        .always_on_top(true)
        .shadow(true)
        .on_navigation(move |url| {
            let raw = url.as_str();
            if should_stay_in_webview(raw) {
                true
            } else {
                let _ = open::that(raw);
                false
            }
        })
        .on_new_window(move |url, _features| {
            let raw = url.as_str();
            if should_stay_in_webview(raw) {
                NewWindowResponse::Allow
            } else {
                let _ = open::that(raw);
                NewWindowResponse::Deny
            }
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shortcut = Shortcut::new(
        Some(Modifiers::SUPER | Modifiers::ALT | Modifiers::SHIFT),
        Code::KeyB,
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut(shortcut)
                .expect("invalid shortcut")
                .with_handler(move |app, sc, event| {
                    if *sc == shortcut && event.state() == ShortcutState::Pressed {
                        toggle_popover(app);
                    }
                })
                .build(),
        )
        .manage(Mutex::new(DesktopState::new()))
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(ActivationPolicy::Accessory);

            create_main_window(app.handle())?;

            let menu = build_menu(app.handle())?;
            let mut tray = TrayIconBuilder::with_id("tray")
                .menu(&menu)
                .icon_as_template(true)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| handle_menu(app, event.id.as_ref()))
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_popover(tray.app_handle());
                    }
                });
            match tauri::image::Image::from_bytes(TRAY_ICON) {
                Ok(icon) => tray = tray.icon(icon),
                Err(err) => {
                    log_line(&format!("tray icon: {err}"));
                    if let Some(icon) = app.default_window_icon() {
                        tray = tray.icon(icon.clone());
                    }
                }
            }
            tray.build(app)?;

            if let Err(err) = app.autolaunch().enable() {
                eprintln!("autostart enable: {err}");
            }

            match spawn_server(app.handle()) {
                Ok(port) => wait_and_navigate(app.handle().clone(), port),
                Err(err) => report_failure(app.handle(), err),
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != WINDOW_LABEL {
                return;
            }
            match event {
                WindowEvent::Resized(_) => {
                    if is_attached(window.app_handle()) {
                        mark_ignore_blur(window.app_handle());
                    }
                }
                WindowEvent::Focused(false) => {
                    let app = window.app_handle();
                    if !is_attached(app) {
                        return;
                    }
                    let ignore = app
                        .state::<Mutex<DesktopState>>()
                        .lock()
                        .map(|s| Instant::now() < s.ignore_blur_until)
                        .unwrap_or(false);
                    if !ignore {
                        let _ = window.hide();
                    }
                }
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    return_to_menubar(window.app_handle());
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building batbelt")
        .run(|app, event| {
            if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
                stop_child(app);
            }
        });
}
