#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, RunEvent};

/** Set once the UI has stopped mpv; the shell plugin hard-kills the sidecar on exit, which would orphan mpv. */
static READY_TO_QUIT: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn quit_ready(app: AppHandle) {
    READY_TO_QUIT.store(true, Ordering::SeqCst);
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![quit_ready])
        .build(tauri::generate_context!())
        .expect("failed to start Subtitle Mirror")
        .run(|app, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                if READY_TO_QUIT.load(Ordering::SeqCst) {
                    return;
                }
                api.prevent_exit();
                let _ = app.emit("quit-requested", ());
                // Don't hang if the UI never answers.
                let app = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(3));
                    READY_TO_QUIT.store(true, Ordering::SeqCst);
                    app.exit(0);
                });
            }
        });
}
