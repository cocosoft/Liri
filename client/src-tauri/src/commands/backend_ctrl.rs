use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tracing::info;

static BACKEND_PROCESS: Lazy<Mutex<Option<BackendProcess>>> = Lazy::new(|| Mutex::new(None));

static BACKEND_PORT: Lazy<Mutex<u16>> = Lazy::new(|| Mutex::new(7890));

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub pid: Option<u32>,
}

struct BackendProcess {
    child: std::process::Child,
}

fn get_backend_command() -> (String, Vec<String>, String) {
    #[cfg(target_os = "windows")]
    {
        ("cmd".to_string(), vec!["/C".to_string(), "py".to_string(), "-m".to_string(), "py_app".to_string(), "repl".to_string()], "windows".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        ("sh".to_string(), vec!["-c".to_string(), "py-app repl".to_string()], "unix".to_string())
    }
}

#[tauri::command]
pub async fn start_backend() -> Result<BackendStatus, String> {
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

    let (program, args, _) = get_backend_command();

    let http_port = current_port.to_string();
    let mut full_args = args;
    full_args.push("--http-port".to_string());
    full_args.push(http_port);

    info!("Starting backend: {} {:?}", program, full_args);

    let child = Command::new(&program)
        .args(&full_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!("Failed to start backend process: {}", e)
        })?;

    let pid = child.id();

    *process_guard = Some(BackendProcess { child });

    info!("Backend started with PID: {}", pid);

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

    if let Some(mut backend) = process_guard.take() {
        backend.child.kill().map_err(|e| {
            format!("Failed to kill backend process: {}", e)
        })?;
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
