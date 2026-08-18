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
use std::path::PathBuf;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tracing::info;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

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

fn create_app_menu(app: &tauri::AppHandle) -> Result<Menu<tauri::Wry>, tauri::Error> {
    // ── 文件 ──
    let settings = MenuItem::with_id(app, "settings", "设置", true, Some("Ctrl+,"))?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let file_menu = Submenu::with_items(app, "文件", true, &[
        &settings,
        &PredefinedMenuItem::separator(app)?,
        &quit,
    ])?;

    // ── 编辑 ──
    let edit_menu = Submenu::with_items(app, "编辑", true, &[
        &PredefinedMenuItem::undo(app, None)?,
        &PredefinedMenuItem::redo(app, None)?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::cut(app, None)?,
        &PredefinedMenuItem::copy(app, None)?,
        &PredefinedMenuItem::paste(app, None)?,
        &PredefinedMenuItem::select_all(app, None)?,
    ])?;

    // ── 视图 ──
    let reload = MenuItem::with_id(app, "reload", "重新加载", true, Some("Ctrl+R"))?;
    let devtools = MenuItem::with_id(app, "devtools", "开发者工具", true, Some("F12"))?;
    let view_menu = Submenu::with_items(app, "视图", true, &[
        &reload,
        &devtools,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::fullscreen(app, None)?,
    ])?;

    // ── 帮助 ──
    let about = MenuItem::with_id(app, "about", "关于 Liri", true, None::<&str>)?;
    let help_menu = Submenu::with_items(app, "帮助", true, &[
        &about,
    ])?;

    Menu::with_items(app, &[&file_menu, &edit_menu, &view_menu, &help_menu])
}

fn create_tray_menu(app: &tauri::AppHandle) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "隐藏窗口", true, None::<&str>)?;
    let separator = MenuItem::with_id(app, "sep", "---", false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    Menu::with_items(app, &[&show, &hide, &separator, &quit])
}

/// 初始化 tracing：控制台 + 文件双输出。
/// 发布版（windows_subsystem=windows，无控制台）下控制台日志不可见，
/// 文件输出（%APPDATA%/com.liri.client/logs/liri-client.log）保证启动/崩溃链路可回溯。
fn init_tracing() -> tracing_appender::non_blocking::WorkerGuard {
    let log_dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.liri.client")
        .join("logs");
    let _ = std::fs::create_dir_all(&log_dir);

    let file_appender = tracing_appender::rolling::daily(&log_dir, "liri-client.log");
    let (file_writer, guard) = tracing_appender::non_blocking(file_appender);

    let filter = EnvFilter::from_default_env()
        .add_directive(tracing::Level::INFO.into());

    let file_layer = tracing_subscriber::fmt::layer()
        .with_writer(file_writer)
        .with_ansi(false)
        .with_target(false);

    let console_layer = tracing_subscriber::fmt::layer()
        .with_ansi(true)
        .with_target(false);

    tracing_subscriber::registry()
        .with(filter)
        .with(console_layer)
        .with(file_layer)
        .init();

    info!("tracing 初始化完成: 控制台 + 文件({}/liri-client.log)", log_dir.display());

    guard
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _tracing_guard = init_tracing();

    info!("Starting Liri Client");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // updater 插件已禁用（无更新服务器）
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::default())
        .manage(ConfigState::default())
        .setup(|app| {
            info!("Application setup started");

            // W8 修复：IPC 会话持久化到 app_data_dir/sessions.json，
            // 重启后降级路径创建的会话不再丢失
            let session_state = app.state::<AppState>();
            let sessions_path = app.path().app_data_dir()?.join("sessions.json");
            session_state.init_storage(sessions_path);

            let handle = app.handle();

            let menu = create_tray_menu(handle)?;
            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Liri")
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

            // 设置窗口顶部菜单栏
            let app_menu = create_app_menu(handle)?;
            app.set_menu(app_menu)?;

            // 菜单事件处理
            app.on_menu_event(|app_handle, event| {
                let window = app_handle.get_webview_window("main");
                match event.id().as_ref() {
                    "settings" => {
                        if let Some(win) = window {
                            let _ = win.eval("window.dispatchEvent(new CustomEvent('liri:navigate', { detail: '/settings' }));");
                        }
                    }
                    "reload" => {
                        if let Some(win) = window {
                            let _ = win.eval("location.reload();");
                        }
                    }
                    "devtools" => {
                        if let Some(webview) = app_handle.get_webview_window("main") {
                            if webview.is_devtools_open() {
                                let _ = webview.close_devtools();
                            } else {
                                let _ = webview.open_devtools();
                            }
                        }
                    }
                    "about" => {
                        if let Some(win) = window {
                            let _ = win.eval(
                                "alert('Liri v0.4.25 - 你的 AI 私人助手');",
                            );
                        }
                    }
                    "quit" => {
                        app_handle.exit(0);
                    }
                    _ => {}
                }
            });

            let window = app.get_webview_window("main").unwrap();
            window.set_title("Liri").unwrap();

            info!("Application setup completed");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::backend_ctrl::start_backend,
            commands::backend_ctrl::stop_backend,
            commands::backend_ctrl::get_backend_status,
            commands::backend_ctrl::http_proxy,
            commands::backend_ctrl::set_backend_port,
            commands::app_config::get_app_config,
            commands::app_config::set_app_config,
            commands::chat::set_backend_url,
            commands::chat::send_message,
            commands::chat::stream_message,
            commands::session::list_sessions,
            commands::session::create_session,
            commands::session::switch_session,
            commands::session::delete_session,
            commands::session::get_current_session,
            commands::session::rename_session,
            commands::session::get_session,
            commands::session::get_session_messages,
            commands::session::clear_all_sessions,
            commands::model::list_models,
            commands::tool::list_tools,
            commands::tool::execute_tool,
            commands::config::get_config,
            commands::config::set_config,
            commands::config::list_config,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // W6 回归修复：应用退出时自动停止后端进程并清理共享密钥。
            // 否则后端进程独立存活，重启后前端拿不到密钥 → 直连请求 401 → 前端显示"后端已停止"。
            if let tauri::RunEvent::Exit = event {
                info!("[RunEvent::Exit] 应用退出，清理后端进程与共享密钥");
                commands::backend_ctrl::shutdown_backend(app_handle);
            }
        });
}