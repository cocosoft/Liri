//! 会话管理命令（HTTP-fallback）
//!
//! 前端通过 HTTP `/v1/sessions/*` 优先调用，失败后降级至此 IPC 通道。

use crate::Session;
use std::sync::Mutex;
use tauri::State;
use tracing::info;
use uuid::Uuid;

pub struct AppState {
    pub sessions: Mutex<Vec<Session>>,
    pub current_session_id: Mutex<Option<String>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(Vec::new()),
            current_session_id: Mutex::new(None),
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
            Ok(())
        }
        None => Err("Session not found".to_string()),
    }
}