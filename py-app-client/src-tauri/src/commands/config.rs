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