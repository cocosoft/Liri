// MIT License
// Copyright (c) 2026 190615273@qq.com

/// Token estimation FFI — safe wrapper with catch_unwind
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

use serde_json::Value;

use crate::error::FfiError;

/// 估算消息数组的 token 数
/// 算法：CJK 字符按 1.5 token/char，其他按 chars/4
fn estimate_message_tokens(json: &str) -> u32 {
    let messages: Vec<Value> = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => return 0,
    };

    let mut total = 0u32;
    for msg in &messages {
        if let Some(content) = msg.get("content").and_then(|c| c.as_str()) {
            total += estimate_text_tokens(content);
        }
    }
    total
}

/// 估算单段文本的 token 数
fn estimate_text_tokens(text: &str) -> u32 {
    let mut cjk_chars = 0u32;
    let mut other_chars = 0u32;

    for ch in text.chars() {
        if is_cjk(ch) {
            cjk_chars += 1;
        } else {
            other_chars += 1;
        }
    }

    // CJK: ~1.5 tokens/char, 其他: chars/4
    (cjk_chars as f64 * 1.5) as u32 + (other_chars / 4) as u32
}

/// 判断是否为 CJK 字符（CJK Unified Ideographs + Extensions）
fn is_cjk(ch: char) -> bool {
    matches!(
        ch,
        '\u{4E00}'..='\u{9FFF}'   // CJK Unified Ideographs
        | '\u{3400}'..='\u{4DBF}'  // CJK Unified Ideographs Extension A
        | '\u{20000}'..='\u{2A6DF}' // CJK Extension B
        | '\u{3040}'..='\u{309F}'  // Hiragana
        | '\u{30A0}'..='\u{30FF}'  // Katakana
        | '\u{AC00}'..='\u{D7AF}'  // Hangul Syllables
    )
}

/// 安全 Token 估算——catch_unwind 包装
#[no_mangle]
pub extern "C" fn estimate_tokens_safe(
    messages_json: *const c_char,
) -> *mut c_char {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let json = unsafe {
            if messages_json.is_null() {
                return FfiError::invalid_input("messages_json is null").to_json();
            }
            CStr::from_ptr(messages_json).to_str().unwrap_or("[]")
        };

        let tokens = estimate_message_tokens(json);
        serde_json::json!({ "tokens": tokens, "method": "chars_cjk" }).to_string()
    }));

    let output = match result {
        Ok(json) => json,
        Err(_) => FfiError::panic_error().to_json(),
    };

    CString::new(output).unwrap_or_default().into_raw()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CString;

    #[test]
    fn test_estimate_text_english() {
        let tokens = estimate_text_tokens("Hello, world!");
        // 13 chars / 4 ≈ 3
        assert!(tokens >= 2 && tokens <= 5);
    }

    #[test]
    fn test_estimate_text_cjk() {
        let tokens = estimate_text_tokens("你好世界");
        // 4 CJK chars * 1.5 ≈ 6
        assert!(tokens >= 4 && tokens <= 10);
    }

    #[test]
    fn test_estimate_text_mixed() {
        let tokens = estimate_text_tokens("Hello 你好 world 世界");
        assert!(tokens > 4);
    }

    #[test]
    fn test_estimate_safe_null_input() {
        let ptr = estimate_tokens_safe(std::ptr::null());
        assert!(!ptr.is_null());
        let result = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap();
        assert!(result.contains("invalid_input"));
        py_free_string(ptr);
    }

    #[test]
    fn test_estimate_safe_valid() {
        let input = CString::new(r#"[{"role":"user","content":"Hello, world!"}]"#).unwrap();
        let ptr = estimate_tokens_safe(input.as_ptr());
        assert!(!ptr.is_null());
        let result = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap();
        let parsed: Value = serde_json::from_str(result).unwrap();
        assert!(parsed["tokens"].as_u64().unwrap() > 0);
        py_free_string(ptr);
    }
}
