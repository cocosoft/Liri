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
use std::net::TcpStream;
use std::sync::Mutex;
use std::time::Duration;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tracing::info;

use super::app_config;

static BACKEND_PROCESS: Lazy<Mutex<Option<BackendProcess>>> =
    Lazy::new(|| Mutex::new(None));

static BACKEND_PORT: Lazy<Mutex<u16>> = Lazy::new(|| Mutex::new(7890));

static BACKEND_SECRET: Lazy<Mutex<Option<String>>> =
    Lazy::new(|| Mutex::new(None));

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub pid: Option<u32>,
    /// 进程退出码（仅当进程已退出时有效）
    pub exit_code: Option<i32>,
    /// 进程 stderr 输出或错误信息
    pub error: Option<String>,
}

struct BackendProcess {
    child: tauri_plugin_shell::process::CommandChild,
    /// 进程退出码（后台任务在进程退出时填充）
    exit_code: Option<i32>,
    /// 进程 stderr 输出（后台任务累积填充）
    stderr_output: String,
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
        // 已有进程记录，检查其是否已崩溃退出
        let exit_code = process_guard.as_ref().and_then(|p| p.exit_code);
        let running = exit_code.is_none();
        let error = process_guard
            .as_ref()
            .and_then(|p| {
                if !p.stderr_output.is_empty() {
                    Some(p.stderr_output.clone())
                } else {
                    None
                }
            });
        return Ok(BackendStatus {
            running,
            port: if running { Some(current_port) } else { None },
            pid: None,
            exit_code,
            error,
        });
    }

    // 断点 5 修复（2026-08-14 排查）：内存无进程记录时探测端口活性。
    // Tauri 前端重启后 BACKEND_PROCESS 静态全局清空，但旧后端进程可能仍存活并
    // 监听 http_port——若不探测直接拉起新实例，双实例竞争同一数据目录（DB 锁冲突、
    // "清理锁被其他进程持有"）。端口可连接 = 已有后端存活，直接复用。
    if let Ok(addr) = format!("127.0.0.1:{}", current_port)
        .parse::<std::net::SocketAddr>()
    {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(500)).is_ok() {
            info!(
                "start_backend: 端口 {} 已被占用，复用现有后端进程（防多实例）",
                current_port
            );
            return Ok(BackendStatus {
                running: true,
                port: Some(current_port),
                pid: None,
                exit_code: None,
                error: None,
            });
        }
    }

    let port_str = current_port.to_string();

    // 确定数据目录，优先使用配置的目录，否则使用安全的本地路径
    // 不依赖 home_dir()，因为安装程序以 SYSTEM 身份运行时 home_dir() 会返回 C:\Users\Default（不可写）
    let data_dir = if !config.data_dir.is_empty() {
        config.data_dir.clone()
    } else {
        app_config::resolve_safe_data_dir()?
    };

    // 确保数据目录存在
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!(
            "无法创建数据目录 '{}'：{}\n\n请检查：\n- 应用是否有权限写入该目录\n- {}",
            data_dir, e,
            if data_dir.contains("\\Default") || data_dir.contains("\\default") {
                "当前运行在 SYSTEM 账户下，无法写入用户目录。请以当前用户身份运行应用"
            } else {
                "app_config.json 中的 dataDir 值是否正确"
            }
        ))?;
    // 同时确保 data 子目录存在（LIRI_DATA_DIR 环境变量指向此处）
    std::fs::create_dir_all(format!("{}/data", data_dir))
        .map_err(|e| format!("Failed to create data subdirectory '{}/data': {}", data_dir, e))?;

    // 获取 Tauri 进程当前工作目录作为项目根目录
    // 开发模式下为项目源代码根目录，确保第一层路径（app/docs/、app/config/ 等）解析正确
    let project_root = std::env::current_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| data_dir.clone());

    // 生成随机共享密钥，防止未经授权的第三方访问后端 API
    let secret = uuid::Uuid::new_v4().to_string();
    {
        let mut secret_guard = BACKEND_SECRET.lock().map_err(|e| e.to_string())?;
        *secret_guard = Some(secret.clone());
    }

    let command = app_handle
        .shell()
        .sidecar("liri_terminal")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?
        .args(["repl", "--http-port", &port_str])
        .current_dir(&data_dir)
        .env("LIRI_HOME", &data_dir)
        .env("LIRI_DATA_DIR", format!("{}/data", data_dir))
        .env("LIRI_PROJECT_DIR", &project_root)
        .env("LIRI_API_SECRET", &secret);

    info!(
        "Starting backend sidecar: liri_terminal repl --http-port={}, LIRI_HOME={:?}",
        current_port,
        if config.data_dir.is_empty() {
            "(default)"
        } else {
            &config.data_dir
        }
    );

    let (mut rx, child) = command
        .spawn()
        .map_err(|e| format!("Failed to start backend sidecar: {}", e))?;

    let pid = child.pid();

    // 启动后台任务：捕获 stderr/stdout 并监听进程退出事件
    tauri::async_runtime::spawn(async move {
        let mut stderr_buf = String::new();

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    stderr_buf.push_str(&text);
                    tracing::warn!("Backend stderr: {}", text.trim());
                }
                CommandEvent::Stdout(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    tracing::info!("Backend: {}", text.trim());
                }
                CommandEvent::Terminated(payload) => {
                    if let Some(code) = payload.code {
                        if let Ok(mut guard) = BACKEND_PROCESS.lock() {
                            if let Some(ref mut proc) = *guard {
                                proc.exit_code = Some(code);
                                if !stderr_buf.is_empty() {
                                    proc.stderr_output = stderr_buf.clone();
                                }
                            }
                        }
                        tracing::warn!(
                            "Backend process exited with code: {}",
                            code
                        );
                    } else {
                        tracing::warn!("Backend process terminated (no exit code)");
                    }
                    break;
                }
                CommandEvent::Error(err) => {
                    tracing::error!("Backend process error: {}", err);
                    if let Ok(mut guard) = BACKEND_PROCESS.lock() {
                        if let Some(ref mut proc) = *guard {
                            proc.stderr_output = err.clone();
                        }
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    *process_guard = Some(BackendProcess {
        child,
        exit_code: None,
        stderr_output: String::new(),
    });

    info!("Backend started with PID: {:?}", pid);

    Ok(BackendStatus {
        running: true,
        port: Some(current_port),
        pid: Some(pid),
        exit_code: None,
        error: None,
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

        // 清除共享密钥
        if let Ok(mut secret_guard) = BACKEND_SECRET.lock() {
            secret_guard.take();
        }

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

    if let Some(ref proc) = *process_guard {
        let running = proc.exit_code.is_none();
        Ok(BackendStatus {
            running,
            port: if running { Some(current_port) } else { None },
            pid: None,
            exit_code: proc.exit_code,
            error: if !proc.stderr_output.is_empty() {
                Some(proc.stderr_output.clone())
            } else {
                None
            },
        })
    } else {
        Ok(BackendStatus {
            running: false,
            port: None,
            pid: None,
            exit_code: None,
            error: None,
        })
    }
}

#[tauri::command]
pub async fn get_backend_secret() -> Result<Option<String>, String> {
    let secret_guard = BACKEND_SECRET.lock().map_err(|e| e.to_string())?;
    Ok(secret_guard.clone())
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
