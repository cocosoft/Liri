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
            http_port: 7890,
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

fn load_config_inner(app_handle: &tauri::AppHandle) -> AppConfig {
    let path = config_file_path(app_handle);

    if !path.exists() {
        return AppConfig::default();
    }

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
