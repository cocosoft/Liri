//! Tauri IPC 命令模块（HTTP-fallback 层）
//!
//! 这些命令作为 HTTP API 的降级回退，仅在以下情况被调用：
//! 1. 后端 HTTP 服务未启动
//! 2. 网络不可达
//! 3. 前端运行在 Tauri 桌面环境中（通过 `__TAURI__` 检测）
//!
//! 前端调用链路：HTTP → Tauri IPC → 内存回退

pub mod app_config;
pub mod backend_ctrl;
pub mod chat;
pub mod config;
pub mod model;
pub mod session;
pub mod tool;