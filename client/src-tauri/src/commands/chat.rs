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

//! 聊天命令（HTTP-fallback）
//!
//! 前端通过 HTTP `/v1/chat/completions` 优先调用，失败后降级至此 IPC 通道。

use crate::Message;
use futures_util::stream::StreamExt;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Window};
use tracing::{error, info};
use uuid::Uuid;

static BACKEND_URL: Lazy<Mutex<String>> = Lazy::new(|| Mutex::new("http://127.0.0.1:7890".to_string()));

/// 哨兵值：同步自 app/src/constants/common.ts 的 DEFAULT_MODEL_SENTINEL = 'pyapp-default'
/// 表示"未选择具体模型，由后端 SmartRouter 自动决策"
const DEFAULT_MODEL_SENTINEL: &str = "pyapp-default";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionRequest {
    pub model: Option<String>,
    pub messages: Vec<ChatMessage>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub stream: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionResponse {
    pub id: String,
    pub object: String,
    pub created: u64,
    pub model: String,
    pub choices: Vec<ChatChoice>,
    pub usage: ChatUsage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatChoice {
    pub index: u32,
    pub message: ChatMessage,
    pub finish_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamChunk {
    pub id: String,
    pub object: String,
    pub created: u64,
    pub model: String,
    pub choices: Vec<StreamChoice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamChoice {
    pub index: u32,
    pub delta: Delta,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Delta {
    pub role: Option<String>,
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendMessageRequest {
    pub content: String,
    pub session_id: Option<String>,
}

fn get_backend_url() -> String {
    BACKEND_URL.lock().unwrap().clone()
}

fn update_backend_url(url: String) {
    *BACKEND_URL.lock().unwrap() = url;
}

#[tauri::command]
pub fn set_backend_url(url: String) -> Result<(), String> {
    info!("Setting backend URL to: {}", url);
    update_backend_url(url);
    Ok(())
}

#[tauri::command]
pub async fn send_message(
    content: String,
    session_id: Option<String>,
) -> Result<Message, String> {
    info!("send_message called with content: {}, session_id: {:?}", content, session_id);

    let backend_url = get_backend_url();

    let request = ChatCompletionRequest {
        model: Some(DEFAULT_MODEL_SENTINEL.to_string()),
        messages: vec![ChatMessage {
            role: "user".to_string(),
            content,
        }],
        temperature: Some(0.7),
        max_tokens: Some(2000),
        stream: Some(false),
    };
    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/v1/chat/completions", backend_url))
        .json(&request)
        .send()
        .await
        .map_err(|e| {
            error!("Failed to send message: {}", e);
            format!("Failed to connect to backend: {}", e)
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        error!("Backend returned error: {} - {}", status, body);
        return Err(format!("Backend error: {} - {}", status, body));
    }

    let completion: ChatCompletionResponse = response.json().await.map_err(|e| {
        error!("Failed to parse response: {}", e);
        format!("Failed to parse response: {}", e)
    })?;

    let assistant_message = completion
        .choices
        .first()
        .map(|c| c.message.content.clone())
        .unwrap_or_default();

    let now = chrono::Utc::now().timestamp_millis();

    Ok(Message {
        id: Uuid::new_v4().to_string(),
        role: "assistant".to_string(),
        content: assistant_message,
        timestamp: now,
        session_id: session_id.unwrap_or_else(|| "default".to_string()),
    })
}

#[tauri::command]
pub async fn stream_message(
    content: String,
    session_id: Option<String>,
    window: Window,
) -> Result<(), String> {
    info!("stream_message called with content: {}", content);

    let backend_url = get_backend_url();
    let session_id = session_id.unwrap_or_else(|| "default".to_string());

    let request = ChatCompletionRequest {
        model: Some(DEFAULT_MODEL_SENTINEL.to_string()),
        messages: vec![ChatMessage {
            role: "user".to_string(),
            content,
        }],
        temperature: Some(0.7),
        max_tokens: Some(2000),
        stream: Some(true),
    };

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/v1/chat/completions", backend_url))
        .json(&request)
        .send()
        .await
        .map_err(|e| {
            error!("Failed to send stream message: {}", e);
            format!("Failed to connect to backend: {}", e)
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        error!("Backend returned error: {} - {}", status, body);
        return Err(format!("Backend error: {} - {}", status, body));
    }

    let mut stream = response.bytes_stream();

    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(bytes) => {
                if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                    for line in text.lines() {
                        if line.starts_with("data: ") {
                            let data = &line[6..];
                            if data == "[DONE]" {
                                let done_payload = serde_json::json!({
                                    "session_id": session_id,
                                    "done": true,
                                });
                                window.emit("stream-done", done_payload)
                                    .map_err(|e| e.to_string())?;
                                return Ok(());
                            }

                            if let Ok(stream_chunk) = serde_json::from_str::<StreamChunk>(data) {
                                let content = stream_chunk.choices
                                    .first()
                                    .and_then(|c| c.delta.content.clone())
                                    .unwrap_or_default();

                                if !content.is_empty() {
                                    let event_payload = serde_json::json!({
                                        "chunk": content,
                                        "index": stream_chunk.choices.first().map(|c| c.index).unwrap_or(0),
                                    });
                                    window.emit("stream-chunk", event_payload)
                                        .map_err(|e| e.to_string())?;
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                error!("Stream error: {}", e);
                let error_payload = serde_json::json!({
                    "error": e.to_string(),
                });
                window.emit("stream-error", error_payload)
                    .map_err(|e| e.to_string())?;
                return Err(e.to_string());
            }
        }
    }

    let done_payload = serde_json::json!({
        "session_id": session_id,
        "done": true,
    });

    window.emit("stream-done", done_payload)
        .map_err(|e| e.to_string())?;

    Ok(())
}
