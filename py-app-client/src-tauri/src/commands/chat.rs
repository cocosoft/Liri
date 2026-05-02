use crate::Message;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Window};
use tracing::info;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendMessageRequest {
    pub content: String,
    pub session_id: Option<String>,
}

#[tauri::command]
pub async fn send_message(
    content: String,
    session_id: Option<String>,
) -> Result<Message, String> {
    info!("send_message called with content: {}, session_id: {:?}", content, session_id);

    let now = chrono::Utc::now().timestamp_millis();
    let msg = Message {
        id: Uuid::new_v4().to_string(),
        role: "user".to_string(),
        content,
        timestamp: now,
        session_id: session_id.unwrap_or_else(|| "default".to_string()),
    };

    Ok(msg)
}

#[tauri::command]
pub async fn stream_message(
    content: String,
    session_id: Option<String>,
    window: Window,
) -> Result<(), String> {
    info!("stream_message called with content: {}", content);

    let session_id = session_id.unwrap_or_else(|| "default".to_string());

    let chunks = content.split_whitespace();

    for (i, chunk) in chunks.enumerate() {
        let event_payload = serde_json::json!({
            "chunk": chunk,
            "index": i,
        });

        window.emit("stream-chunk", event_payload).map_err(|e| e.to_string())?;

        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    }

    let done_payload = serde_json::json!({
        "session_id": session_id,
        "done": true,
    });

    window.emit("stream-done", done_payload).map_err(|e| e.to_string())?;

    Ok(())
}