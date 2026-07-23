// MIT License
// Copyright (c) 2026 190615273@qq.com

use serde::Serialize;

/// FFI 错误响应结构
#[derive(Serialize)]
pub struct FfiError {
    pub error: String,
    pub code: String, // "native_panic" | "invalid_input" | "oom"
}

impl FfiError {
    pub fn new(error: &str, code: &str) -> Self {
        FfiError {
            error: error.to_string(),
            code: code.to_string(),
        }
    }

    pub fn panic_error() -> Self {
        FfiError::new("native panic in FFI call", "native_panic")
    }

    pub fn invalid_input(msg: &str) -> Self {
        FfiError::new(msg, "invalid_input")
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| {
            r#"{"error":"serialization_failed","code":"internal"}"#.to_string()
        })
    }
}
