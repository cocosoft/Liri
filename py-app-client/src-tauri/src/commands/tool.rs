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