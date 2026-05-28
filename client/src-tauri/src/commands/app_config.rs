use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub data_dir: String,
    pub http_port: u16,
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
