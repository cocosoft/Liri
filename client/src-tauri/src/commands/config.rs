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

//! 配置管理命令（HTTP-fallback）
//!
//! 前端通过 HTTP `/v1/config/*` 优先调用，失败后降级至此 IPC 通道。

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;
use tracing::info;

pub struct ConfigState {
    pub config: Mutex<HashMap<String, serde_json::Value>>,
}

impl Default for ConfigState {
    fn default() -> Self {
        let mut config = HashMap::new();
        config.insert("theme".to_string(), serde_json::json!("light"));
        config.insert("language".to_string(), serde_json::json!("zh-CN"));
        config.insert("fontSize".to_string(), serde_json::json!(14));

        Self {
            config: Mutex::new(config),
        }
    }
}

#[tauri::command]
pub async fn get_config(
    key: String,
    state: State<'_, ConfigState>,
) -> Result<serde_json::Value, String> {
    info!("get_config called with key: {}", key);

    let config = state.config.lock().map_err(|e| e.to_string())?;
    config.get(&key).cloned().ok_or_else(|| "Key not found".to_string())
}

#[tauri::command]
pub async fn set_config(
    key: String,
    value: serde_json::Value,
    state: State<'_, ConfigState>,
) -> Result<(), String> {
    info!("set_config called with key: {}, value: {:?}", key, value);

    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    config.insert(key, value);

    Ok(())
}

#[tauri::command]
pub async fn list_config(
    state: State<'_, ConfigState>,
) -> Result<HashMap<String, serde_json::Value>, String> {
    info!("list_config called");

    let config = state.config.lock().map_err(|e| e.to_string())?;
    Ok(config.clone())
}