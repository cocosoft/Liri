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

//! 会话管理命令（HTTP-fallback）
//!
//! 前端通过 HTTP `/v1/sessions/*` 优先调用，失败后降级至此 IPC 通道。

use crate::Message;
use crate::Session;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;
use tracing::info;
use uuid::Uuid;

pub struct AppState {
    pub sessions: Mutex<Vec<Session>>,
    pub current_session_id: Mutex<Option<String>>,
    /// 会话消息（降级路径：HTTP 不可用时前端仅读写内存态，此处提供消息查询能力）
    pub messages: Mutex<HashMap<String, Vec<Message>>>,
    /// 持久化文件路径（setup 时经 init_storage 绑定，None = 未持久化）
    storage_path: Mutex<Option<PathBuf>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(Vec::new()),
            current_session_id: Mutex::new(None),
            messages: Mutex::new(HashMap::new()),
            storage_path: Mutex::new(None),
        }
    }
}

impl AppState {
    /// 绑定持久化文件路径并加载已有会话
    /// W8 修复：IPC 会话此前存内存 Vec，重启即清空——前端降级路径创建的会话
    /// 刷新/重启后消失（"数据丢失"）。现持久化到 app_data_dir/sessions.json。
    pub fn init_storage(&self, path: PathBuf) {
        if let Ok(content) = fs::read_to_string(&path) {
            match serde_json::from_str::<Vec<Session>>(&content) {
                Ok(loaded) => {
                    if let Ok(mut sessions) = self.sessions.lock() {
                        *sessions = loaded;
                    }
                }
                Err(e) => info!("sessions.json 解析失败，忽略并重建: {}", e),
            }
        }
        if let Ok(mut storage) = self.storage_path.lock() {
            *storage = Some(path);
        }
    }

    /// 将当前会话列表写回持久化文件（W8 修复）
    fn persist(&self) {
        let path = self.storage_path.lock().ok().and_then(|g| g.clone());
        let Some(path) = path else { return };
        let Ok(sessions) = self.sessions.lock() else { return };
        if let Ok(json) = serde_json::to_string_pretty(&*sessions) {
            if let Some(dir) = path.parent() {
                let _ = fs::create_dir_all(dir);
            }
            let _ = fs::write(&path, json);
        }
    }
}

#[tauri::command]
pub async fn list_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<Session>, String> {
    info!("list_sessions called");
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    Ok(sessions.clone())
}

#[tauri::command]
pub async fn create_session(
    title: String,
    state: State<'_, AppState>,
) -> Result<Session, String> {
    info!("create_session called with title: {}", title);

    let now = chrono::Utc::now().timestamp_millis();
    let session = Session {
        id: Uuid::new_v4().to_string(),
        title,
        created_at: now,
        last_modified_at: now,
        message_count: 0,
    };

    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    sessions.push(session.clone());

    let mut current_id = state.current_session_id.lock().map_err(|e| e.to_string())?;
    *current_id = Some(session.id.clone());

    // W8 修复：变更后落盘，重启保留
    state.persist();

    Ok(session)
}

#[tauri::command]
pub async fn switch_session(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    info!("switch_session called with id: {}", id);

    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let exists = sessions.iter().any(|s| s.id == id);

    if !exists {
        return Err("Session not found".to_string());
    }

    let mut current_id = state.current_session_id.lock().map_err(|e| e.to_string())?;
    *current_id = Some(id);

    Ok(())
}

#[tauri::command]
pub async fn delete_session(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    info!("delete_session called with id: {}", id);

    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    sessions.retain(|s| s.id != id);

    let mut current_id = state.current_session_id.lock().map_err(|e| e.to_string())?;
    if *current_id == Some(id.clone()) {
        *current_id = sessions.first().map(|s| s.id.clone());
    }

    // W8 修复：变更后落盘，重启保留
    state.persist();

    Ok(())
}

#[tauri::command]
pub async fn get_current_session(
    state: State<'_, AppState>,
) -> Result<Option<Session>, String> {
    info!("get_current_session called");

    let current_id = state.current_session_id.lock().map_err(|e| e.to_string())?;
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;

    let session = current_id.as_ref().and_then(|id| {
        sessions.iter().find(|s| s.id == *id).cloned()
    });

    Ok(session)
}

#[tauri::command]
pub async fn rename_session(
    id: String,
    title: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    info!("rename_session called with id: {}, title: {}", id, title);

    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions.iter_mut().find(|s| s.id == id);

    match session {
        Some(s) => {
            s.title = title;
            // W8 修复：变更后落盘，重启保留
            state.persist();
            Ok(())
        }
        None => Err("Session not found".to_string()),
    }
}

#[tauri::command]
pub async fn get_session(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<Session>, String> {
    info!("get_session called with id: {}", id);

    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    Ok(sessions.iter().find(|s| s.id == id).cloned())
}

#[tauri::command]
pub async fn get_session_messages(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<Message>, String> {
    info!("get_session_messages called with session_id: {}", session_id);

    let messages = state.messages.lock().map_err(|e| e.to_string())?;
    Ok(messages.get(&session_id).cloned().unwrap_or_default())
}

#[tauri::command]
pub async fn clear_all_sessions(
    state: State<'_, AppState>,
) -> Result<(), String> {
    info!("clear_all_sessions called");

    state.sessions.lock().map_err(|e| e.to_string())?.clear();
    *state
        .current_session_id
        .lock()
        .map_err(|e| e.to_string())? = None;
    state.messages.lock().map_err(|e| e.to_string())?.clear();
    // W8 修复：变更后落盘，重启保留
    state.persist();

    Ok(())
}