fn main() {
    // The tray icon is `default_window_icon`, which `generate_context!` bakes
    // into the binary from bundle.icon at compile time. Cargo does not treat
    // the icon files as inputs, so without this a replaced icon keeps serving
    // the cached RGBA from a previous build.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
