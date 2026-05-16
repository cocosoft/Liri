use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tracing::info;

pub mod commands;
#[cfg(test)]
pub mod tests;

use commands::config::ConfigState;
use commands::session::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub last_modified_at: i64,
    pub message_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: i64,
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tool {
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub read_only: bool,
    pub destructive: bool,
}

fn create_tray_menu(app: &tauri::AppHandle) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "隐藏窗口", true, None::<&str>)?;
    let separator = MenuItem::with_id(app, "sep", "---", false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    Menu::with_items(app, &[&show, &hide, &separator, &quit])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .init();

    info!("Starting PY_APP Client");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::default())
        .manage(ConfigState::default())
        .setup(|app| {
            info!("Application setup started");

            let handle = app.handle();

            let menu = create_tray_menu(handle)?;
            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("PY_APP")
                .on_menu_event(|app, event| {
                    let window = app.get_webview_window("main");
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(win) = window {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                        "hide" => {
                            if let Some(win) = window {
                                let _ = win.hide();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            let window = app.get_webview_window("main").unwrap();
            window.set_title("PY_APP").unwrap();

            info!("Application setup completed");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::backend_ctrl::start_backend,
            commands::backend_ctrl::stop_backend,
            commands::backend_ctrl::get_backend_status,
            commands::backend_ctrl::set_backend_port,
            commands::chat::set_backend_url,
            commands::chat::send_message,
            commands::chat::stream_message,
            commands::session::list_sessions,
            commands::session::create_session,
            commands::session::switch_session,
            commands::session::delete_session,
            commands::session::get_current_session,
            commands::tool::list_tools,
            commands::tool::execute_tool,
            commands::config::get_config,
            commands::config::set_config,
            commands::config::list_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}