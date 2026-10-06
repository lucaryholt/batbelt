# batbelt

<img width="1089" height="807" alt="image" src="https://github.com/user-attachments/assets/6968bba2-3f94-4440-85b8-daca74834d82" />

Localhost toolbox with a shared UI shell. Modules:

- **[Homepage](src/modules/homepage/README.md)** — First page: collapsible sections of URL and folder shortcuts, plus a starred row above them
- **[Kubefwd](src/modules/kubefwd/README.md)** — Kubernetes port-forwards, GCP proxy pods, port checker, and cluster/GCP explore
- **[Steamer](src/modules/steamer/README.md)** — Read-only OpenBao KV comparison with links to make changes in the OpenBao UI
- **[Kickflip](src/modules/kickflip/README.md)** — Tick YAML-configured services, then annotate ExternalSecrets and/or rollout-restart them
- **[PR Looker](src/modules/prlooker/README.md)** — GitHub PR inbox (review, assigned, authored, mentioned) via `gh`

⌃1–⌃9 jump to the enabled modules in sidebar order, in the browser and the menu bar app alike. ⌃⇧1–⌃⇧9 open pages of the module you are already in. Typing a letter outside a text field jumps to Homepage search when `typeToSearch` is on (default) and Homepage is enabled. Which modules load is set in `~/.config/batbelt/modules.yaml` (restart to apply). A missing file loads all five.

The server binds to `127.0.0.1` only.

## Requirements

- Node.js 20+
- [`kubectl`](https://kubernetes.io/docs/tasks/tools/) on your `PATH` for Kubefwd and Kickflip
- The [`bao`](https://openbao.org/docs/commands/) CLI on your `PATH` for Steamer
- The [`gh`](https://cli.github.com/) CLI on your `PATH` for PR Looker
- `code` / `pi` on `PATH` for Homepage folder shortcuts; Kitty tabs also work from an installed `kitty.app` without `kitten` on `PATH`
- OIDC already enabled on each OpenBao instance, with `http://localhost:8250/oidc/callback` allowed as a redirect URI

On macOS with [Homebrew](https://brew.sh), install `kubectl`, `bao` (formula `openbao`), and `gh`:

```bash
./scripts/install-clis.sh
```

That does not run `npm install`, start an OpenBao server, or log you in. `gh auth login`, kubeconfig, and OpenBao OIDC stay separate. Formula `bao` conflicts with `openbao` (both install a `bao` binary); the script will not unlink it.

## Setup

```bash
npm install
npm run dev
```

This starts the API on [http://127.0.0.1:3870](http://127.0.0.1:3870) and the Vite UI on [http://127.0.0.1:3871](http://127.0.0.1:3871). Open the Vite URL during development.

Production:

```bash
npm run build
npm start
```

`npm start` serves the built UI from the API port (`3870` by default).

```bash
batbelt [--port 3870] [--db PATH] [--import-yaml PATH] [--debug] [--open] [--default] [--default-proxy]
```

| Flag | Meaning |
| --- | --- |
| `--port` | HTTP port (default `3870`) |
| `--db` | Kubefwd SQLite path (default `~/.config/batbelt/kubefwd.db`) |
| `--import-yaml` | Import a kubefwd YAML file into that SQLite database, then start |
| `--debug` | Kubefwd debug log (`/tmp/kubefwd-debug.log`) |
| `--open` | Open the UI in a browser |
| `--default` | Auto-start Kubefwd services marked `selected_by_default` |
| `--default-proxy` | Auto-start Kubefwd proxy services marked `selected_by_default` |

An empty SQLite database is valid. Explore and Add Service populate it.

Enabled modules are listed in `~/.config/batbelt/modules.yaml` (`$XDG_CONFIG_HOME/batbelt/modules.yaml` when that env var is set). Batbelt does not create this file; if it is missing, all modules start in the order below. Homepage can be omitted. The list order is sidebar and ⌃1–⌃n order. Invalid YAML, unknown ids, or duplicates abort before the server listens. Change the file and restart (including the menu bar app) to apply it.

```yaml
enabled:
  - homepage
  - kubefwd
  - steamer
  - kickflip
  - prlooker
typeToSearch: true   # optional; default true. Set false to disable type-anywhere Homepage search
```

## macOS menu bar

A Tauri 2 wrapper lives in `src-tauri/`. It stays in the menu bar (no Dock icon) until you pop the window out.

Requirements: Node.js 20+, [Rust](https://rustup.rs/) (`rustc`), and Xcode Command Line Tools (`xcode-select --install`).

```bash
npm install
npm run desktop:dev    # `npm run build` then `tauri dev` (menu bar, debug)
npm run desktop        # production `.app` + DMG under `src-tauri/target/release/bundle/`
```

The wrapper starts `node dist/cli.js` with your login-shell `PATH` (so `kubectl`, `bao`, `code`, `gh`, `pi`, and `kitten` still work). If something is already healthy on `127.0.0.1:3870`–`3879`, it attaches instead of spawning a second server. Set `BATBELT_HOME` to override the repo path.

It prefers the `node` your shell resolves, but `better-sqlite3` is a native module tied to one Node major version, and which Node comes first on `PATH` changes whenever nvm's default does. So the launcher asks each candidate (shell `node`, then installed nvm versions newest to oldest, then `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`) to open a database and uses the first that can. Run `npm rebuild better-sqlite3` under the Node you want if you'd rather it use a newer one. Launcher and server output goes to `~/Library/Logs/batbelt-desktop.log`.

| Control | Action |
| --- | --- |
| Menu bar icon (left click) | Toggle the popover (top centre of the active screen) |
| Menu bar icon (right click) | Open the tray menu |
| Tray **Open** | Same toggle |
| ⌘⌥⇧B | Same toggle |
| **Pop out** (tray menu) | Same window, title bar, resizable, Dock icon |
| Popover edge | Resize the attached window (minimum 480×400) |
| Window close | Return to menu bar (does not quit) |
| **Quit** (tray menu) | Stop the Node server the app spawned and exit |
| **Open in browser** | Open the localhost UI in your browser |

External links (Homepage shortcuts, OIDC on port `8250`) open in the system browser. On first launch the app enables a Login Item (`tauri-plugin-autostart`); manage it in **System Settings → General → Login Items**. Finder-launched apps often miss Homebrew/nvm; the wrapper prepends those to `PATH`. Closing the window does not quit: use **Quit** in the tray menu.

### Release

Create a desktop release from a clean, synchronized `main` branch:

```bash
npm run release -- patch       # or minor, major, or an exact version such as 1.2.3
```

The command requires macOS, Node.js/npm, Rust/Cargo, Xcode Command Line Tools, Git, and an authenticated GitHub CLI (`gh auth login`). It:

1. Updates the version in `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`.
2. Runs typechecking and tests, then builds the production Tauri application.
3. Commits the version files as `Release vX.Y.Z`, creates and pushes the annotated `vX.Y.Z` tag, and uploads the generated DMG to GitHub Releases with generated notes.

The DMG is currently unsigned and may trigger a macOS Gatekeeper warning. Before the release commit, failures restore the original version files. If publishing fails after the commit or tag is pushed, the script prints safe retry commands; do not rewrite the pushed release history.

## Data

| Path | Contents |
| --- | --- |
| `~/.config/batbelt/modules.yaml` | Enabled modules and sidebar order (optional; missing means all five) |
| `~/.config/batbelt/homepage/config.yaml` | Homepage sections, shortcuts, and Pi terminal |
| `~/.config/batbelt/kubefwd.db` | Kubefwd services and settings |
| `~/.config/batbelt/steamer/config.yaml` | Steamer environments |
| `~/.config/batbelt/steamer/tokens/` | Per-environment OpenBao tokens (`0600`) |
| `~/.config/batbelt/kickflip/config.yaml` | Kickflip contexts, namespaces, and services |
| `~/.config/batbelt/prlooker/config.yaml` | PR Looker poll interval and team slugs |

The original kubefwd and bao-helper apps keep their own files. To bring an existing kubefwd YAML across:

```bash
npx tsx src/cli.ts --import-yaml ~/.kubefwd.yaml
```

## Modules

- [Homepage](src/modules/homepage/README.md) — Links board with URL and folder tiles, a starred row, and a homepage-wide Pi terminal. YAML + UI CRUD; confirm deletes only.
- [Kubefwd](src/modules/kubefwd/README.md) — Services, Proxy, Port Checker, Explore. SQLite only; YAML is `--import-yaml`.
- [Steamer](src/modules/steamer/README.md) — Read-only Secrets comparison + editable Settings. Secret changes open in OpenBao; settings saves are confirmed. OIDC callback on port `8250`.
- [Kickflip](src/modules/kickflip/README.md) — Services tile grid. File-only YAML; first start seeds the old restarter lists.
- [PR Looker](src/modules/prlooker/README.md) — Inbox tabs via `gh search prs`. File-only YAML for poll interval and teams.
