// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

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

    // 从持久化配置中加载端口，并同步到内存缓存
    let config = app_config::load_config(&app_handle);
    {
        let mut port_guard = BACKEND_PORT.lock().map_err(|e| e.to_string())?;
        *port_guard = config.http_port;
    }
    let port_guard = BACKEND_PORT.lock().map_err(|e| e.to_string())?;
    let current_port = *port_guard;

    if process_guard.is_some() {
        return Ok(BackendStatus {
            running: true,
            port: Some(current_port),
            pid: None,
        });
    }

    let port_str = current_port.to_string();

    // 确定数据目录，优先使用配置的目录，否则使用用户目录下的 .pyapp
    let data_dir = if !config.data_dir.is_empty() {
        config.data_dir.clone()
    } else {
        format!("{}\\.pyapp", dirs::home_dir().unwrap_or_default().display())
    };

    let mut command = app_handle
        .shell()
        .sidecar("Liri_coding")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?
        .args(["repl", "--http-port", &port_str])
        .current_dir(&data_dir)
        .env("PYAPP_HOME", &data_dir)
        .env("PYAPP_DATA_DIR", format!("{}/data", data_dir))
        .env("PYAPP_PROJECT_DIR", &data_dir);

    info!(
        "Starting backend sidecar: Liri_coding repl --http-port={}, PYAPP_HOME={:?}",
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
pub async fn set_backend_port(app_handle: tauri::AppHandle, port: u16) -> Result<(), String> {
    // 更新内存缓存
    let mut port_guard = BACKEND_PORT.lock().map_err(|e| e.to_string())?;
    *port_guard = port;
    drop(port_guard);

    // 持久化到配置文件
    let mut config = app_config::load_config(&app_handle);
    config.http_port = port;
    app_config::save_config(&app_handle, &config)?;

    info!("Backend port set to: {} and persisted", port);
    Ok(())
}
