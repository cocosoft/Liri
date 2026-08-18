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

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tracing::{error, info, warn};

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
    /// 共享密钥（W6 回归修复：重新暴露给前端，供直连 fetch 注入 X-API-Key）
    /// 仅当本进程持有密钥时返回（新拉起后端路径）；复用既有进程时为 None
    pub secret: Option<String>,
}

struct BackendProcess {
    child: tauri_plugin_shell::process::CommandChild,
    /// 进程退出码（后台任务在进程退出时填充）
    exit_code: Option<i32>,
    /// 进程 stderr 输出（后台任务累积填充）
    stderr_output: String,
}

/// 读取当前共享密钥（BACKEND_SECRET 未设置时返回 None）
fn current_secret() -> Option<String> {
    BACKEND_SECRET.lock().ok().and_then(|g| g.clone())
}

/// 共享密钥持久化文件路径（与 app_config.json 同目录，随配置一起被系统管理）
fn secret_file_path(app_handle: &tauri::AppHandle) -> PathBuf {
    let config_dir = app_handle
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    config_dir.join("backend_secret.json")
}

/// 将共享密钥写入磁盘（内存 + 磁盘双写，Tauri 进程重启后可从盘恢复）
fn persist_secret(app_handle: &tauri::AppHandle, secret: &str) {
    let path = secret_file_path(app_handle);
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            warn!("[secret] 创建密钥目录失败 {}: {}", parent.display(), e);
            return;
        }
    }
    let payload = serde_json::json!({ "secret": secret });
    match std::fs::write(&path, serde_json::to_string_pretty(&payload).unwrap_or_default()) {
        Ok(_) => info!("[secret] 共享密钥已持久化: {}", path.display()),
        Err(e) => warn!("[secret] 共享密钥持久化失败 {}: {}", path.display(), e),
    }
}

/// 获取当前共享密钥：内存优先，内存为空时从磁盘恢复并回填内存
fn load_secret(app_handle: &tauri::AppHandle) -> Option<String> {
    if let Some(s) = current_secret() {
        return Some(s);
    }
    let path = secret_file_path(app_handle);
    let content = std::fs::read_to_string(&path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&content).ok()?;
    let secret = value.get("secret")?.as_str()?.to_string();
    if let Ok(mut guard) = BACKEND_SECRET.lock() {
        *guard = Some(secret.clone());
    }
    info!("[secret] 已从磁盘恢复共享密钥");
    Some(secret)
}

/// 清除共享密钥：内存 + 磁盘
fn clear_secret(app_handle: &tauri::AppHandle) {
    if let Ok(mut guard) = BACKEND_SECRET.lock() {
        guard.take();
    }
    let path = secret_file_path(app_handle);
    match std::fs::remove_file(&path) {
        Ok(_) => info!("[secret] 持久化密钥已清除: {}", path.display()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => warn!("[secret] 删除持久化密钥失败 {}: {}", path.display(), e),
    }
}

/// 应用退出钩子调用：同步停止后端进程并清理共享密钥
/// （避免后端进程独立存活导致重启后密钥不匹配，W6 回归根因之一）
pub fn shutdown_backend(app_handle: &tauri::AppHandle) {
    info!("[shutdown_backend] 应用退出，停止后端进程");
    let mut process_guard = match BACKEND_PROCESS.lock() {
        Ok(g) => g,
        Err(_) => {
            warn!("[shutdown_backend] 无法获取进程锁，跳过停止");
            return;
        }
    };
    if let Some(backend) = process_guard.take() {
        match backend.child.kill() {
            Ok(_) => info!("[shutdown_backend] 后端进程已 kill"),
            Err(e) => warn!("[shutdown_backend] 后端进程 kill 失败: {}", e),
        }
    } else {
        info!("[shutdown_backend] 无进程记录（可能已被前端 stop_backend 停止）");
    }
    drop(process_guard);
    clear_secret(app_handle);
}

#[tauri::command]
pub async fn start_backend(app_handle: tauri::AppHandle) -> Result<BackendStatus, String> {
    info!("[start_backend] 前端请求启动后端");

    let mut process_guard = BACKEND_PROCESS.lock().map_err(|e| e.to_string())?;

    // 从持久化配置中加载端口，并同步到内存缓存
    let config = app_config::load_config(&app_handle);
    {
        let mut port_guard = BACKEND_PORT.lock().map_err(|e| e.to_string())?;
        *port_guard = config.http_port;
    }
    let port_guard = BACKEND_PORT.lock().map_err(|e| e.to_string())?;
    let current_port = *port_guard;
    info!(
        "[start_backend] 配置加载完成: http_port={}, data_dir={:?}, first_run_completed={}",
        current_port,
        if config.data_dir.is_empty() { "(空，将自动解析)" } else { &config.data_dir },
        config.first_run_completed
    );

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
        info!(
            "[start_backend] 已有进程记录: running={}, exit_code={:?}, stderr_len={}",
            running,
            exit_code,
            error.as_ref().map(|s| s.len()).unwrap_or(0)
        );
        return Ok(BackendStatus {
            running,
            port: if running { Some(current_port) } else { None },
            pid: None,
            exit_code,
            error,
            secret: load_secret(&app_handle),
        });
    }

    // 断点 5 修复（2026-08-14 排查）：内存无进程记录时探测端口活性。
    // Tauri 前端重启后 BACKEND_PROCESS 静态全局清空，但旧后端进程可能仍存活并
    // 监听 http_port——若不探测直接拉起新实例，双实例竞争同一数据目录（DB 锁冲突、
    // "清理锁被其他进程持有"）。端口可连接 = 已有后端存活，直接复用。
    let port_busy = if let Ok(addr) = format!("127.0.0.1:{}", current_port)
        .parse::<std::net::SocketAddr>()
    {
        TcpStream::connect_timeout(&addr, Duration::from_millis(500)).is_ok()
    } else {
        false
    };
    if port_busy {
        info!(
            "[start_backend] 端口 {} 已被占用，复用现有后端进程（防多实例）",
            current_port
        );
        return Ok(BackendStatus {
            running: true,
            port: Some(current_port),
            pid: None,
            exit_code: None,
            error: None,
            secret: load_secret(&app_handle),
        });
    }
    info!("[start_backend] 端口 {} 空闲，准备拉起新后端进程", current_port);

    let port_str = current_port.to_string();

    // 确定数据目录，优先使用配置的目录，否则使用安全的本地路径
    // 不依赖 home_dir()，因为安装程序以 SYSTEM 身份运行时 home_dir() 会返回 C:\Users\Default（不可写）
    let data_dir = if !config.data_dir.is_empty() {
        config.data_dir.clone()
    } else {
        match app_config::resolve_safe_data_dir() {
            Ok(dir) => {
                info!("[start_backend] data_dir 为空，自动解析为: {}", dir);
                dir
            }
            Err(e) => {
                error!("[start_backend] 自动解析 data_dir 失败: {}", e);
                return Err(e);
            }
        }
    };
    info!("[start_backend] 最终数据目录: {}", data_dir);

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
    info!("[start_backend] 数据目录已就绪: {}（含 data 子目录）", data_dir);

    // 获取 Tauri 进程当前工作目录作为项目根目录
    // 开发模式下为项目源代码根目录，确保第一层路径（app/docs/、app/config/ 等）解析正确
    let project_root = std::env::current_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| data_dir.clone());
    info!("[start_backend] Tauri current_dir(project_root) = {}", project_root);

    // 生成随机共享密钥，防止未经授权的第三方访问后端 API
    let secret = uuid::Uuid::new_v4().to_string();
    {
        let mut secret_guard = BACKEND_SECRET.lock().map_err(|e| e.to_string())?;
        *secret_guard = Some(secret.clone());
    }
    // W6 回归修复：密钥持久化到磁盘，Tauri 进程重启后可从盘恢复
    persist_secret(&app_handle, &secret);

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
        "[start_backend] 启动 sidecar: liri_terminal repl --http-port={}, \
         cwd={}, LIRI_HOME={}, LIRI_DATA_DIR={}/data, LIRI_PROJECT_DIR={}",
        current_port, data_dir, data_dir, data_dir, project_root
    );

    let (mut rx, child) = command
        .spawn()
        .map_err(|e| {
            let msg = format!(
                "Failed to start backend sidecar: {}。请检查安装目录下 liri_terminal.exe 是否存在",
                e
            );
            error!("[start_backend] sidecar spawn 失败: {}", msg);
            msg
        })?;

    let pid = child.pid();
    info!("[start_backend] sidecar 已启动: pid={}", pid);

    // 启动后台任务：捕获 stderr/stdout 并监听进程退出事件
    tauri::async_runtime::spawn(async move {
        let mut stderr_buf = String::new();
        let mut stdout_lines = 0usize;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    stderr_buf.push_str(&text);
                    warn!("[backend:stderr] {}", text.trim());
                }
                CommandEvent::Stdout(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    stdout_lines += 1;
                    info!("[backend:stdout] {}", text.trim());
                }
                CommandEvent::Terminated(payload) => {
                    info!(
                        "[start_backend] 后端进程退出: exit_code={:?}, signal={:?}, 累计 stdout 行数={}, 累计 stderr 长度={}",
                        payload.code,
                        payload.signal,
                        stdout_lines,
                        stderr_buf.len()
                    );
                    if let Some(code) = payload.code {
                        if let Ok(mut guard) = BACKEND_PROCESS.lock() {
                            if let Some(ref mut proc) = *guard {
                                proc.exit_code = Some(code);
                                if !stderr_buf.is_empty() {
                                    proc.stderr_output = stderr_buf.clone();
                                }
                            }
                        }
                        warn!(
                            "Backend process exited with code: {}",
                            code
                        );
                    } else {
                        warn!("Backend process terminated (no exit code)");
                    }
                    break;
                }
                CommandEvent::Error(err) => {
                    error!("[start_backend] 后端进程事件错误: {}", err);
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
        info!("[start_backend] 进程事件监听结束（后端已退出或通道关闭）");
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
        secret: load_secret(&app_handle),
    })
}

#[tauri::command]
pub async fn stop_backend(app_handle: tauri::AppHandle) -> Result<(), String> {
    info!("[stop_backend] 前端请求停止后端");

    let mut process_guard = BACKEND_PROCESS.lock().map_err(|e| e.to_string())?;

    if let Some(backend) = process_guard.take() {
        backend
            .child
            .kill()
            .map_err(|e| format!("Failed to kill backend process: {}", e))?;

        // 清除共享密钥（内存 + 磁盘）
        clear_secret(&app_handle);

        info!("[stop_backend] 后端进程已 kill");
    } else {
        info!("[stop_backend] 无进程记录，无需停止");
    }

    Ok(())
}

#[tauri::command]
pub async fn get_backend_status(app_handle: tauri::AppHandle) -> Result<BackendStatus, String> {
    let process_guard = BACKEND_PROCESS.lock().map_err(|e| e.to_string())?;
    let port_guard = BACKEND_PORT.lock().map_err(|e| e.to_string())?;
    let current_port = *port_guard;

    let status = if let Some(ref proc) = *process_guard {
        let running = proc.exit_code.is_none();
        info!(
            "[get_backend_status] 进程记录存在: running={}, exit_code={:?}, stderr_len={}",
            running,
            proc.exit_code,
            proc.stderr_output.len()
        );
        BackendStatus {
            running,
            port: if running { Some(current_port) } else { None },
            pid: None,
            exit_code: proc.exit_code,
            error: if !proc.stderr_output.is_empty() {
                Some(proc.stderr_output.clone())
            } else {
                None
            },
            secret: load_secret(&app_handle),
        }
    } else {
        info!(
            "[get_backend_status] 无进程记录（running=false, port={}）",
            current_port
        );
        BackendStatus {
            running: false,
            port: None,
            pid: None,
            exit_code: None,
            error: None,
            secret: load_secret(&app_handle),
        }
    };
    Ok(status)
}

// W6 修复：get_backend_secret 已删除——共享密钥仅由 Rust 内部持有，
// 通过 http_proxy 注入 X-API-Key，前端 JS 不再可调用获取（防 XSS 窃取 → RCE）。

#[derive(Debug, Deserialize)]
pub struct ProxyRequest {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    /// N-2：multipart 表单字段（文件内容 base64），与 body 互斥
    #[serde(default)]
    pub form_parts: Option<Vec<ProxyFormPart>>,
}

#[derive(Debug, Deserialize)]
pub struct ProxyFormPart {
    pub name: String,
    pub filename: Option<String>,
    /// 字段内容（文件或文本，均 base64 编码）
    pub content: String,
    #[serde(rename = "content_type")]
    pub content_type: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ProxyResponse {
    pub status: u16,
    pub body: String,
    /// N-1：二进制响应（下载/预览）时返回 base64，前端解码为 Blob
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body_base64: Option<String>,
}

/// W6 修复：HTTP 代理 command —— 前端 JS 不再接触 LIRI_API_SECRET。
/// 请求经 Rust 侧转发，共享密钥在此注入 X-API-Key，WebView JS 上下文永不持有明文密钥。
#[tauri::command]
pub async fn http_proxy(
    app_handle: tauri::AppHandle,
    request: ProxyRequest,
) -> Result<ProxyResponse, String> {
    // 内存优先，Tauri 重启后内存为空时从磁盘恢复
    let secret = load_secret(&app_handle);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .map_err(|e| format!("invalid method {}: {}", request.method, e))?;

    let mut req = client.request(method, &request.url);

    // 注入共享密钥（仅 Rust 侧持有，JS 不可见）
    if let Some(ref s) = secret {
        req = req.header("X-API-Key", s);
    }

    // 合并前端自定义 headers（禁止覆盖 X-API-Key）
    if let Some(headers) = request.headers {
        for (k, v) in headers {
            if k.to_lowercase() != "x-api-key" {
                req = req.header(&k, v);
            }
        }
    }

    // N-2：multipart 表单重建（reqwest 自动生成含 boundary 的 Content-Type）
    if let Some(parts) = request.form_parts {
        let mut form = reqwest::multipart::Form::new();
        for p in parts {
            let bytes = BASE64
                .decode(&p.content)
                .map_err(|e| format!("form part base64 解码失败: {}", e))?;
            let mut part = reqwest::multipart::Part::bytes(bytes);
            if let Some(fname) = p.filename {
                part = part.file_name(fname);
            }
            if let Some(ct) = p.content_type {
                part = part
                    .mime_str(&ct)
                    .map_err(|e| format!("mime 解析失败: {}", e))?;
            }
            form = form.part(p.name, part);
        }
        req = req.multipart(form);
    } else if let Some(ref body) = request.body {
        req = req
            .header("Content-Type", "application/json")
            .body(body.clone());
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();

    // N-1：非文本响应按二进制读取并 base64 返回（下载/预览场景，文本转 base64 会损坏）
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    let is_binary = !(content_type.is_empty()
        || content_type.contains("json")
        || content_type.contains("text")
        || content_type.contains("xml")
        || content_type.contains("html"));
    if is_binary {
        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
        Ok(ProxyResponse {
            status,
            body: String::new(),
            body_base64: Some(BASE64.encode(&bytes)),
        })
    } else {
        let body = resp.text().await.map_err(|e| e.to_string())?;
        Ok(ProxyResponse {
            status,
            body,
            body_base64: None,
        })
    }
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
