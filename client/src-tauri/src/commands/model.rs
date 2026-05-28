//! 模型管理命令（HTTP-fallback）
//!
//! 前端通过 HTTP `/v1/models` 优先调用，失败后降级至此 IPC 通道。

use serde::{Deserialize, Serialize};
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub provider: String,
    #[serde(rename = "type")]
    pub model_type: String,
    pub context_length: u32,
    pub enabled: bool,
}

#[tauri::command]
pub async fn list_models() -> Result<Vec<ModelInfo>, String> {
    info!("list_models called");

    let models = vec![
        ModelInfo {
            id: "gpt-4".to_string(),
            name: "GPT-4".to_string(),
            provider: "OpenAI".to_string(),
            model_type: "chat".to_string(),
            context_length: 8192,
            enabled: true,
        },
        ModelInfo {
            id: "gpt-3.5-turbo".to_string(),
            name: "GPT-3.5 Turbo".to_string(),
            provider: "OpenAI".to_string(),
            model_type: "chat".to_string(),
            context_length: 4096,
            enabled: true,
        },
        ModelInfo {
            id: "claude-3".to_string(),
            name: "Claude 3".to_string(),
            provider: "Anthropic".to_string(),
            model_type: "chat".to_string(),
            context_length: 100000,
            enabled: true,
        },
    ];

    Ok(models)
}
