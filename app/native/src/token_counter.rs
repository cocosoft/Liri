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

use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use crate::json_util::{JsonValue, parse_json};

/// Model-specific token multiplier (approximation of different tokenizers)
fn get_token_multiplier(model: &str) -> f64 {
    let model_lower = model.to_lowercase();
    if model_lower.contains("gpt-4o") || model_lower.contains("gpt-4.1") {
        0.80
    } else if model_lower.contains("claude") || model_lower.contains("sonnet") {
        0.90
    } else if model_lower.contains("gpt-4") {
        1.00
    } else if model_lower.contains("gpt-3.5") || model_lower.contains("gpt-35") {
        1.30
    } else if model_lower.contains("deepseek") {
        1.10
    } else if model_lower.contains("qwen") || model_lower.contains("通义") {
        1.15
    } else if model_lower.contains("gemini") {
        0.95
    } else {
        1.00
    }
}

fn estimate_tokens_impl(text: &str, model: Option<&str>) -> i32 {
    let base_count: f64 = if text.is_empty() {
        0.0
    } else {
        let char_count = text.chars().count() as f64;
        let word_count = text.split_whitespace().count().max(1) as f64;

        let cjk_chars: usize = text.chars().filter(|&c| {
            let code = c as u32;
            (code >= 0x4E00 && code <= 0x9FFF)
                || (code >= 0x3400 && code <= 0x4DBF)
                || (code >= 0x20000 && code <= 0x2A6DF)
        }).count();

        let cjk_ratio = cjk_chars as f64 / char_count;
        let estimated: f64;
        if cjk_ratio > 0.3 {
            estimated = cjk_chars as f64 * 1.5 + (char_count - cjk_chars as f64) * 0.25;
        } else {
            estimated = word_count * 1.3 + char_count * 0.05;
        }
        estimated.max(1.0)
    };

    let multiplier = model.map(get_token_multiplier).unwrap_or(1.0);
    let result = (base_count * multiplier).ceil() as i64;
    if result > i32::MAX as i64 { i32::MAX } else { result as i32 }
}

fn count_tokens_impl(messages_json: &str, model: Option<&str>) -> String {
    let messages = match parse_json(messages_json) {
        Ok(JsonValue::Array(arr)) => arr,
        Ok(_) => return r#"{"error":"Expected JSON array","total":0,"per_message":[],"model":"unknown","encoding":"cl100k_base","is_approximate":true}"#.to_string(),
        Err(e) => return format!(r#"{{"error":{},"total":0,"per_message":[],"model":"unknown","encoding":"cl100k_base","is_approximate":true}}"#,
            JsonValue::String(e).to_json_string()),
    };

    let model_name = model.unwrap_or("unknown").to_string();
    let mut per_message = Vec::new();
    let mut total = 0i32;

    for msg in &messages {
        let content = msg.get("content")
            .and_then(|c| c.as_str())
            .unwrap_or("");
        let role = msg.get("role")
            .and_then(|r| r.as_str())
            .unwrap_or("user");

        let role_overhead = match role {
            "system" => 4,
            "user" => 5,
            "assistant" => 5,
            _ => 3,
        };
        let tokens = estimate_tokens_impl(content, Some(&model_name)) + role_overhead;
        per_message.push(tokens);
        total += tokens;
    }

    build_count_result(total, per_message, &model_name, true)
}

#[no_mangle]
pub extern "C" fn py_estimate_tokens(text: *const c_char, model: *const c_char) -> i32 {
    let text_str = unsafe { CStr::from_ptr(text) }.to_str().unwrap_or("");
    let model_str = if model.is_null() {
        None
    } else {
        unsafe { CStr::from_ptr(model) }.to_str().ok()
    };
    estimate_tokens_impl(text_str, model_str)
}

#[no_mangle]
pub extern "C" fn py_count_tokens(messages_json: *const c_char, model: *const c_char) -> *mut c_char {
    let json_str = unsafe { CStr::from_ptr(messages_json) }.to_str().unwrap_or("[]");
    let model_str = if model.is_null() {
        None
    } else {
        unsafe { CStr::from_ptr(model) }.to_str().ok()
    };
    let result = count_tokens_impl(json_str, model_str);
    CString::new(result).unwrap_or_default().into_raw()
}

/// Build JSON string manually (mini helper to avoid macro complexity)
fn build_count_result(total: i32, per_message: Vec<i32>, model: &str, is_approximate: bool) -> String {
    let per_msg: Vec<String> = per_message.iter().map(|v| v.to_string()).collect();
    format!(
        r#"{{"total":{},"per_message":[{}],"model":"{}","encoding":"cl100k_base","is_approximate":{}}}"#,
        total,
        per_msg.join(","),
        model,
        if is_approximate { "true" } else { "false" }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_estimate_tokens_empty() {
        assert_eq!(estimate_tokens_impl("", None), 0);
    }

    #[test]
    fn test_estimate_tokens_short_text() {
        let tokens = estimate_tokens_impl("Hello world", None);
        assert!(tokens > 0);
        assert!(tokens < 20);
    }

    #[test]
    fn test_estimate_tokens_long_text() {
        let text = "The quick brown fox jumps over the lazy dog. ".repeat(100);
        let tokens = estimate_tokens_impl(&text, None);
        assert!(tokens > 0);
        assert!(tokens < 10000, "Token count {} too high for 100 sentences", tokens);
    }

    #[test]
    fn test_estimate_tokens_cjk() {
        let text = "你好世界，这是一个测试句子，用来验证中文token估算。";
        let tokens = estimate_tokens_impl(text, None);
        assert!(tokens > 0);
        assert!(tokens < 100);
    }

    #[test]
    fn test_estimate_tokens_cjk_high_ratio() {
        let text = "你好世界这是一段中文文本没有英文内容完全由汉字组成用于测试高CJK比例场景";
        let tokens = estimate_tokens_impl(text, None);
        assert!(tokens > 0);
        assert!(tokens < 100);
    }

    #[test]
    fn test_get_token_multiplier_gpt4o() {
        let m = get_token_multiplier("gpt-4o");
        assert!((m - 0.80).abs() < 0.01);
    }

    #[test]
    fn test_get_token_multiplier_claude() {
        let m = get_token_multiplier("claude-sonnet-4");
        assert!((m - 0.90).abs() < 0.01);
    }

    #[test]
    fn test_get_token_multiplier_deepseek() {
        let m = get_token_multiplier("deepseek-chat");
        assert!((m - 1.10).abs() < 0.01);
    }

    #[test]
    fn test_get_token_multiplier_unknown() {
        let m = get_token_multiplier("unknown-model");
        assert!((m - 1.00).abs() < 0.01);
    }

    #[test]
    fn test_model_specific_estimation() {
        let text = "Hello world, this is a test message for token estimation.";
        let default = estimate_tokens_impl(text, None);
        let gpt4o = estimate_tokens_impl(text, Some("gpt-4o"));
        assert!(gpt4o <= default, "gpt-4o should have fewer or equal tokens than default");

        let deepseek = estimate_tokens_impl(text, Some("deepseek-chat"));
        assert!(deepseek >= default, "deepseek should have more or equal tokens than default");
    }

    #[test]
    fn test_count_tokens_empty_array() {
        let result = count_tokens_impl("[]", None);
        assert!(result.contains("\"total\":0"));
    }

    #[test]
    fn test_count_tokens_single_message() {
        let json = r#"[{"role":"user","content":"Hello world"}]"#;
        let result = count_tokens_impl(json, None);
        assert!(result.contains("\"total\":"));
        assert!(result.contains("\"per_message\":["));
        assert!(result.contains("\"is_approximate\":true"));
    }

    #[test]
    fn test_count_tokens_multi_message() {
        let json = r#"[
            {"role":"system","content":"You are a helpful assistant"},
            {"role":"user","content":"Hello"},
            {"role":"assistant","content":"Hi there!"}
        ]"#;
        let result = count_tokens_impl(json, None);
        assert!(result.contains("\"total\":"));
        let total_val: i32 = result.split("\"total\":")
            .nth(1)
            .and_then(|s| s.split(',').next())
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        assert!(total_val > 0, "Total should be positive, got {}", total_val);
    }

    #[test]
    fn test_count_tokens_invalid_json() {
        let result = count_tokens_impl("not json", None);
        assert!(result.contains("\"error\""));
    }

    #[test]
    fn test_count_tokens_with_model() {
        let json = r#"[{"role":"user","content":"Hello"}]"#;
        let result = count_tokens_impl(json, Some("gpt-4o"));
        assert!(result.contains("\"model\":\"gpt-4o\""));
    }

    #[test]
    fn test_estimate_tokens_very_long() {
        let text = "word ".repeat(10000);
        let tokens = estimate_tokens_impl(&text, None);
        assert!(tokens > 0);
        assert!(tokens < 200000, "Token count {} too high for 10000 words", tokens);
    }

    #[test]
    fn test_estimate_tokens_special_chars() {
        let text = "!@#$%^&*()_+-=[]{}|;':\",./<>?`~";
        let tokens = estimate_tokens_impl(text, None);
        assert!(tokens > 0);
        assert!(tokens < 100);
    }
}
