use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri_plugin_shell::ShellExt;
use tracing::info;

use super::app_config;

static BACKEND_PROCESS: Lazy<Mutex<Option<BackendProcess>>> =
    Lazy::new(|| Mutex::new(None));

static BACKEND_PORT: Lazy<Mutex<u16>> = Lazy::new(|| Mutex::new(7890));

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub pid: Option<u32>,
}

struct BackendProcess {
    child: tauri_plugin_shell::process::CommandChild,
}

#[tauri::command]
pub async fn start_backend(app_handle: tauri::AppHandle) -> Result<BackendStatus, String> {
    info!("start_backend called");

    let mut process_guard = BACKEND_PROCESS.lock().map_err(|e| e.to_string())?;
    let port_guard = BACKEND_PORT.lock().map_err(|e| e.to_string())?;
    let current_port = *port_guard;

    if process_guard.is_some() {
        return Ok(BackendStatus {
            running: true,
            port: Some(current_port),
            pid: None,
        });
    }

    let config = app_config::load_config(&app_handle);
    let port_str = current_port.to_string();

    let mut command = app_handle
        .shell()
        .sidecar("py_app_coding")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?
        .args(["repl", "--http-port", &port_str]);

    if !config.data_dir.is_empty() {
        let data_dir = &config.data_dir;
        command = command
            .env("PYAPP_HOME", data_dir)
            .env("PYAPP_DATA_DIR", format!("{}/data", data_dir));
    }

    info!(
        "Starting backend sidecar: py_app_coding repl --http-port={}, PYAPP_HOME={:?}",
        current_port,
        if config.data_dir.is_empty() {
            "(default)"
        } else {
            &config.data_dir
        }
    );

    let (_, child) = command
        .spawn()
        .map_err(|e| format!("Failed to start backend sidecar: {}", e))?;

    let pid = child.pid();

    *process_guard = Some(BackendProcess { child });

    info!("Backend started with PID: {:?}", pid);

    Ok(BackendStatus {
        running: true,
        port: Some(current_port),
        pid: Some(pid),
    })
}

#[tauri::command]
pub async fn stop_backend() -> Result<(), String> {
    info!("stop_backend called");

    let mut process_guard = BACKEND_PROCESS.lock().map_err(|e| e.to_string())?;

    if let Some(backend) = process_guard.take() {
        backend
            .child
            .kill()
            .map_err(|e| format!("Failed to kill backend process: {}", e))?;
        info!("Backend process killed");
    } else {
        info!("No backend process to stop");
    }

    Ok(())
}

#[tauri::command]
pub async fn get_backend_status() -> Result<BackendStatus, String> {
    let process_guard = BACKEND_PROCESS.lock().map_err(|e| e.to_string())?;
    let port_guard = BACKEND_PORT.lock().map_err(|e| e.to_string())?;
    let current_port = *port_guard;

    let running = process_guard.is_some();

    Ok(BackendStatus {
        running,
        port: if running { Some(current_port) } else { None },
        pid: None,
    })
}

#[tauri::command]
pub async fn set_backend_port(port: u16) -> Result<(), String> {
    let mut port_guard = BACKEND_PORT.lock().map_err(|e| e.to_string())?;
    *port_guard = port;
    info!("Backend port set to: {}", port);
    Ok(())
}
