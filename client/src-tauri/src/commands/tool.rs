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

//! 工具管理命令（HTTP-fallback）
//!
//! 前端通过 HTTP `/v1/tools/*` 优先调用，失败后降级至此 IPC 通道。

use crate::Tool;
use tracing::info;

#[tauri::command]
pub async fn list_tools() -> Result<Vec<Tool>, String> {
    info!("list_tools called");

    let tools = vec![
        Tool {
            name: "read".to_string(),
            description: "读取文件内容".to_string(),
            enabled: true,
            read_only: true,
            destructive: false,
        },
        Tool {
            name: "write".to_string(),
            description: "写入文件内容".to_string(),
            enabled: true,
            read_only: false,
            destructive: false,
        },
        Tool {
            name: "glob".to_string(),
            description: "文件搜索工具".to_string(),
            enabled: true,
            read_only: true,
            destructive: false,
        },
        Tool {
            name: "grep".to_string(),
            description: "文本搜索工具".to_string(),
            enabled: true,
            read_only: true,
            destructive: false,
        },
    ];

    Ok(tools)
}

#[tauri::command]
pub async fn execute_tool(
    tool_name: String,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    info!("execute_tool called with tool_name: {}, args: {:?}", tool_name, args);

    let result = serde_json::json!({
        "success": true,
        "tool": tool_name,
        "result": "Tool execution placeholder"
    });

    Ok(result)
}