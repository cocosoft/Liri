// MIT License
// Copyright (c) 2026 190615273@qq.com

/// Context compression FFI — safe wrappers with catch_unwind
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

use serde_json::Value;

use crate::error::FfiError;

/// Drop 策略：移除被标记为可丢弃的 tool_result 消息
fn compress_drop(json: &str) -> String {
    let messages: Vec<Value> = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(e) => {
            return FfiError::invalid_input(&format!("Invalid JSON: {}", e)).to_json();
        }
    };

    // 过滤掉 role=tool 且无实际内容的消息
    let filtered: Vec<Value> = messages
        .into_iter()
        .filter(|msg| {
            let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("");
            if role != "tool" {
                return true;
            }
            // tool 消息有 content 则保留
            let content = msg.get("content");
            if let Some(c) = content {
                if let Some(s) = c.as_str() {
                    return !s.is_empty();
                }
            }
            // tool 消息有 tool_call_id 说明是配对调用结果，保留
            msg.get("tool_call_id").is_some()
        })
        .collect();

    serde_json::to_string(&filtered).unwrap_or_else(|_| json.to_string())
}

/// 安全压缩——catch_unwind 包装
/// 接收 JSON 消息数组和策略字符串，返回压缩后的 JSON 字符串
#[no_mangle]
pub extern "C" fn compress_messages_safe(
    messages_json: *const c_char,
    strategy: *const c_char,
) -> *mut c_char {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let json = unsafe {
            if messages_json.is_null() {
                return FfiError::invalid_input("messages_json is null").to_json();
            }
            CStr::from_ptr(messages_json).to_str().unwrap_or("[]")
        };
        let strat = unsafe {
            if strategy.is_null() {
                "drop"
            } else {
                CStr::from_ptr(strategy).to_str().unwrap_or("drop")
            }
        };

        match strat {
            "drop" => compress_drop(json),
            _ => {
                // 未知策略 → 原样返回（TS 侧 HybridEngine 负责压缩）
                json.to_string()
            }
        }
    }));

    let output = match result {
        Ok(json) => json,
        Err(_) => FfiError::panic_error().to_json(),
    };

    CString::new(output).unwrap_or_default().into_raw()
}

/// 释放由 FFI 函数返回的字符串内存
/// 调用方必须在获取结果后调用此函数，否则内存泄漏
#[no_mangle]
pub extern "C" fn py_free_string(ptr: *mut c_char) {
    if !ptr.is_null() {
        unsafe {
            let _ = CString::from_raw(ptr);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CString;

    #[test]
    fn test_compress_drop_normal() {
        let input = r#"[{"role":"user","content":"hello"},{"role":"tool","content":"result"},{"role":"assistant","content":"ok"}]"#;
        let result = compress_drop(input);
        let parsed: Vec<Value> = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed.len(), 3);
    }

    #[test]
    fn test_compress_drop_filters_empty_tool() {
        let input = r#"[{"role":"user","content":"hello"},{"role":"tool","content":""}]"#;
        let result = compress_drop(input);
        let parsed: Vec<Value> = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0]["role"], "user");
    }

    #[test]
    fn test_py_free_string_null() {
        py_free_string(std::ptr::null_mut());
    }

    #[test]
    fn test_compress_safe_null_input() {
        let strat = CString::new("drop").unwrap();
        let ptr = compress_messages_safe(std::ptr::null(), strat.as_ptr());
        assert!(!ptr.is_null());
        let result = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap();
        assert!(result.contains("invalid_input"));
        py_free_string(ptr);
    }

    #[test]
    fn test_compress_safe_invalid_json() {
        let input = CString::new("not json").unwrap();
        let strat = CString::new("drop").unwrap();
        let ptr = compress_messages_safe(input.as_ptr(), strat.as_ptr());
        assert!(!ptr.is_null());
        let result = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap();
        assert!(result.contains("invalid_input"));
        py_free_string(ptr);
    }
}
