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

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(alias = "data_dir")]
    pub data_dir: String,
    #[serde(alias = "http_port")]
    pub http_port: u16,
    #[serde(alias = "first_run_completed")]
    pub first_run_completed: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            data_dir: String::new(),
            http_port: 18990,
            first_run_completed: false,
        }
    }
}

fn config_file_path(app_handle: &tauri::AppHandle) -> PathBuf {
    let config_dir = app_handle
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    config_dir.join("app_config.json")
}

/// 安全的数据目录解析
///
/// 不依赖 `home_dir()` API（会返回 C:\Users\Default 当进程以 SYSTEM 身份运行时）。
/// 优先级：
///   1. USERPROFILE 环境变量（排除 C:\Users\Default 等系统保护目录）
///   2. 应用可执行文件所在目录下的 `.pyapp` 子目录
pub fn resolve_safe_data_dir() -> Result<String, String> {
    // 第一步：尝试 USERPROFILE（大多数正常登录用户都有这个变量）
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        let lower = userprofile.to_lowercase();
        // 排除系统保护目录
        let is_system_profile = lower.ends_with("\\default")
            || lower.ends_with(r"\default user")
            || lower.contains("\\systemprofile");
        if !is_system_profile {
            // 验证目录可写
            let test_dir = format!("{}\\{}", userprofile, ".pyapp");
            if std::fs::create_dir_all(&test_dir).is_ok() {
                return Ok(test_dir);
            }
        }
    }

    // 第二步：使用可执行文件所在目录
    // 适用于安装包部署场景——数据跟随应用目录
    let exe_dir = std::env::current_exe()
        .map_err(|e| format!("无法获取可执行文件路径: {}", e))?
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or("无法解析可执行文件父目录")?;
    let data_dir = exe_dir.join(".pyapp");
    let data_dir_str = data_dir.display().to_string();
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("无法创建数据目录 '{}': {}", data_dir_str, e))?;
    Ok(data_dir_str)
}

fn load_config_inner(app_handle: &tauri::AppHandle) -> AppConfig {
    let path = config_file_path(app_handle);

    let mut config = if !path.exists() {
        AppConfig::default()
    } else {
        match fs::read_to_string(&path) {
            Ok(content) => {
                serde_json::from_str(&content).unwrap_or_else(|e| {
                    info!("Failed to parse config file, using defaults: {}", e);
                    AppConfig::default()
                })
            }
            Err(e) => {
                info!("Failed to read config file, using defaults: {}", e);
                AppConfig::default()
            }
        }
    };

    // 兜底：data_dir 为空时，自动解析安全目录并写回配置
    // 避免 home_dir() 回退路径在新环境中返回 C:\Users\Default 导致权限错误
    if config.data_dir.is_empty() {
        match resolve_safe_data_dir() {
            Ok(safe_dir) => {
                config.data_dir = safe_dir;
                // 写回配置文件，后续启动直接使用
                if let Err(e) = save_config_inner(app_handle, &config) {
                    info!("Failed to persist auto-resolved data_dir: {}", e);
                } else {
                    info!("Auto-resolved and persisted data_dir: {}", config.data_dir);
                }
            }
            Err(e) => {
                info!("Failed to resolve safe data_dir (keeping empty): {}", e);
            }
        }
    }

    config
}

fn save_config_inner(app_handle: &tauri::AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = config_file_path(app_handle);

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config dir: {}", e))?;
    }

    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    fs::write(&path, content).map_err(|e| format!("Failed to write config file: {}", e))?;

    info!("App config saved to {:?}", path);
    Ok(())
}

#[tauri::command]
pub async fn get_app_config(app_handle: tauri::AppHandle) -> Result<AppConfig, String> {
    Ok(load_config_inner(&app_handle))
}

#[tauri::command]
pub async fn set_app_config(
    app_handle: tauri::AppHandle,
    config: AppConfig,
) -> Result<(), String> {
    save_config_inner(&app_handle, &config)
}

pub fn load_config(app_handle: &tauri::AppHandle) -> AppConfig {
    load_config_inner(app_handle)
}

pub fn save_config(app_handle: &tauri::AppHandle, config: &AppConfig) -> Result<(), String> {
    save_config_inner(app_handle, config)
}
