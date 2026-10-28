//! Keeps CardForge's background work (the UI engineer's turns and other queued jobs) running on
//! Android when the app is minimized or the phone is locked: a foreground service with an
//! "Engineer working" notification and a partial wake lock, started while a job runs. On other
//! platforms the commands do nothing; desktop apps keep running when minimized.

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Runtime, command,
    plugin::{Builder, TauriPlugin},
};

/// What the notification says.
#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    title: Option<String>,
    text: Option<String>,
}

#[cfg(target_os = "android")]
struct KeepAlive<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[cfg(target_os = "android")]
fn run<R: Runtime>(app: &AppHandle<R>, method: &str, status: Status) -> Result<(), String> {
    use tauri::Manager;
    app.state::<KeepAlive<R>>()
        .0
        .run_mobile_plugin::<serde_json::Value>(method, status)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
fn run<R: Runtime>(_app: &AppHandle<R>, _method: &str, _status: Status) -> Result<(), String> {
    Ok(())
}

/// Starts the foreground service with its notification.
#[command]
async fn start<R: Runtime>(app: AppHandle<R>, title: Option<String>, text: Option<String>) -> Result<(), String> {
    run(&app, "start", Status { title, text })
}

/// Changes what the notification says.
#[command]
async fn update<R: Runtime>(app: AppHandle<R>, title: Option<String>, text: Option<String>) -> Result<(), String> {
    run(&app, "update", Status { title, text })
}

/// Stops the service. With a title, a notice is left that the work finished.
#[command]
async fn stop<R: Runtime>(app: AppHandle<R>, title: Option<String>, text: Option<String>) -> Result<(), String> {
    run(&app, "stop", Status { title, text })
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("keepalive")
        .invoke_handler(tauri::generate_handler![start, update, stop])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle = _api.register_android_plugin("com.cardforge.keepalive", "KeepAlivePlugin")?;
                _app.manage(KeepAlive(handle));
            }
            Ok(())
        })
        .build()
}
