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

fn estimate_message_tokens(msg: &JsonValue) -> i32 {
    let content = msg.get("content").and_then(|c| c.as_str()).unwrap_or("");
    let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("user");

    let content_len = content.chars().count() as f64;
    let word_count = content.split_whitespace().count().max(1) as f64;

    let cjk_chars: usize = content.chars().filter(|&c| {
        let code = c as u32;
        (code >= 0x4E00 && code <= 0x9FFF)
            || (code >= 0x3400 && code <= 0x4DBF)
            || (code >= 0x20000 && code <= 0x2A6DF)
    }).count();

    let estimated = if content_len == 0.0 {
        0.0
    } else {
        let cjk_ratio = cjk_chars as f64 / content_len;
        if cjk_ratio > 0.3 {
            cjk_chars as f64 * 1.5 + (content_len - cjk_chars as f64) * 0.25
        } else {
            word_count * 1.3 + content_len * 0.05
        }
    };

    let role_overhead = match role {
        "system" => 4,
        "user" => 5,
        "assistant" => 5,
        _ => 3,
    };

    (estimated.ceil() as i32) + role_overhead
}

fn compress_messages_impl(messages_json: &str, config_json: &str) -> String {
    let messages = match parse_json(messages_json) {
        Ok(JsonValue::Array(arr)) => arr,
        Ok(_) => return r#"{"error":"Expected JSON array","messages":[],"original_count":0,"compressed_count":0,"total_tokens":0}"#.to_string(),
        Err(e) => return format!(r#"{{"error":{},"messages":[],"original_count":0,"compressed_count":0,"total_tokens":0}}"#,
            JsonValue::String(e).to_json_string()),
    };

    let config = parse_json(config_json).unwrap_or(JsonValue::Null);
    let max_tokens = config.get("max_tokens").and_then(|v| v.as_i64()).unwrap_or(4000) as i32;
    let keep_recent = config.get("keep_recent_messages").and_then(|v| v.as_i64()).unwrap_or(5) as usize;
    let strategy = config.get("strategy").and_then(|v| v.as_str()).unwrap_or("hybrid");

    let original_count = messages.len();
    if original_count == 0 {
        return r#"{"messages":[],"original_count":0,"compressed_count":0,"total_tokens":0}"#.to_string();
    }

    let total_tokens: i32 = messages.iter().map(|m| estimate_message_tokens(m)).sum();

    let compressed_messages: Vec<&JsonValue> = match strategy {
        "drop" => {
            if total_tokens <= max_tokens {
                messages.iter().collect()
            } else {
                let mut kept = Vec::new();
                let recent_start = if original_count > keep_recent {
                    original_count - keep_recent
                } else {
                    0
                };
                for i in recent_start..original_count {
                    kept.push(&messages[i]);
                }
                let sum: i32 = kept.iter().map(|m| estimate_message_tokens(m)).sum();
                if sum > max_tokens {
                    kept.clear();
                    let mut running = 0i32;
                    for i in (0..original_count).rev() {
                        let t = estimate_message_tokens(&messages[i]);
                        if running + t <= max_tokens {
                            running += t;
                            kept.push(&messages[i]);
                        } else {
                            break;
                        }
                    }
                    kept.reverse();
                }
                kept
            }
        }
        _ => {
            messages.iter().collect()
        }
    };

    let compressed_count = compressed_messages.len();
    let final_tokens: i32 = compressed_messages.iter().map(|m| estimate_message_tokens(m)).sum();

    let msg_json: Vec<JsonValue> = compressed_messages.iter().map(|m| (*m).clone()).collect();

    let mut result_obj = std::collections::BTreeMap::new();
    result_obj.insert("messages".to_string(), JsonValue::Array(msg_json));
    result_obj.insert("original_count".to_string(), JsonValue::Number(original_count as f64));
    result_obj.insert("compressed_count".to_string(), JsonValue::Number(compressed_count as f64));
    result_obj.insert("total_tokens".to_string(), JsonValue::Number(final_tokens as f64));

    JsonValue::Object(result_obj).to_json_string()
}

fn estimate_compression_ratio_impl(messages_json: &str) -> f64 {
    let messages = match parse_json(messages_json) {
        Ok(JsonValue::Array(arr)) => arr,
        _ => return 0.0,
    };

    if messages.is_empty() {
        return 0.0;
    }

    let total_tokens: i32 = messages.iter().map(|m| estimate_message_tokens(m)).sum();
    let old_msgs = messages.len().saturating_sub(5) as i32;
    let avg_tokens = if messages.is_empty() { 0 } else { total_tokens / messages.len() as i32 };
    let removed_tokens = old_msgs * avg_tokens;

    if total_tokens == 0 {
        0.0
    } else {
        1.0 - (total_tokens - removed_tokens).max(1) as f64 / total_tokens as f64
    }
}

#[no_mangle]
pub extern "C" fn py_compress_messages(
    messages_json: *const c_char,
    config_json: *const c_char,
) -> *mut c_char {
    let msg_str = unsafe { CStr::from_ptr(messages_json) }.to_str().unwrap_or("[]");
    let cfg_str = unsafe { CStr::from_ptr(config_json) }.to_str().unwrap_or("{}");
    let result = compress_messages_impl(msg_str, cfg_str);
    CString::new(result).unwrap_or_default().into_raw()
}

#[no_mangle]
pub extern "C" fn py_estimate_compression_ratio(messages_json: *const c_char) -> f64 {
    let msg_str = unsafe { CStr::from_ptr(messages_json) }.to_str().unwrap_or("[]");
    estimate_compression_ratio_impl(msg_str)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_msg(role: &str, content: &str) -> String {
        format!(r#"{{"role":"{}","content":"{}"}}"#, role, content)
    }

    #[test]
    fn test_compress_empty() {
        let result = compress_messages_impl("[]", "{}");
        assert!(result.contains("\"original_count\":0"));
        assert!(result.contains("\"messages\":[]"));
    }

    #[test]
    fn test_compress_single_message() {
        let msg = make_msg("user", "Hello");
        let result = compress_messages_impl(&format!("[{}]", msg), "{}");
        assert!(result.contains("\"original_count\":1"));
        assert!(result.contains("\"compressed_count\":1"));
    }

    #[test]
    fn test_compress_messages_with_content() {
        let msgs = vec![
            make_msg("system", "You are a helpful assistant"),
            make_msg("user", "What is Rust?"),
            make_msg("assistant", "Rust is a systems programming language"),
        ];
        let json = format!("[{}]", msgs.join(","));
        let result = compress_messages_impl(&json, "{}");
        assert!(result.contains("\"original_count\":3"));
        assert!(result.contains("\"compressed_count\":3"));
        assert!(result.contains("\"total_tokens\":"));
        assert!(result.contains("\"messages\""));
    }

    #[test]
    fn test_compress_drop_strategy_recent_only() {
        let mut msgs = Vec::new();
        for i in 0..10 {
            msgs.push(make_msg("user", &format!("Message number {}", i)));
        }
        let json = format!("[{}]", msgs.join(","));
        let config = r#"{"strategy":"drop","keep_recent_messages":3,"max_tokens":1000}"#;
        let result = compress_messages_impl(&json, config);
        assert!(result.contains("\"compressed_count\":"));
    }

    #[test]
    fn test_compress_drop_with_token_limit() {
        let mut msgs = Vec::new();
        for i in 0..20 {
            msgs.push(make_msg("user", "This is a long message that will take many tokens to represent in the compressed format "));
        }
        let json = format!("[{}]", msgs.join(","));
        let config = r#"{"strategy":"drop","keep_recent_messages":2,"max_tokens":20}"#;
        let result = compress_messages_impl(&json, config);
        assert!(result.contains("\"compressed_count\":"));
    }

    #[test]
    fn test_compress_invalid_json() {
        let result = compress_messages_impl("not json", "{}");
        assert!(result.contains("\"error\""));
    }

    #[test]
    fn test_compress_non_array() {
        let result = compress_messages_impl("{}", "{}");
        assert!(result.contains("\"error\""));
    }

    #[test]
    fn test_estimate_compression_ratio_empty() {
        let ratio = estimate_compression_ratio_impl("[]");
        assert!((ratio - 0.0).abs() < 0.01);
    }

    #[test]
    fn test_estimate_compression_ratio_few_messages() {
        let msgs = vec![
            make_msg("user", "Hello"),
            make_msg("assistant", "Hi there!"),
        ];
        let json = format!("[{}]", msgs.join(","));
        let ratio = estimate_compression_ratio_impl(&json);
        assert!(ratio >= 0.0);
        assert!(ratio < 1.0);
    }

    #[test]
    fn test_estimate_compression_ratio_many_messages() {
        let mut msgs = Vec::new();
        for i in 0..20 {
            msgs.push(make_msg("user", &format!("Message number {} with some content", i)));
        }
        let json = format!("[{}]", msgs.join(","));
        let ratio = estimate_compression_ratio_impl(&json);
        assert!(ratio > 0.0);
        assert!(ratio < 1.0);
    }

    #[test]
    fn test_estimate_compression_ratio_invalid_json() {
        let ratio = estimate_compression_ratio_impl("invalid");
        assert!((ratio - 0.0).abs() < 0.01);
    }

    #[test]
    fn test_estimate_message_tokens_system() {
        let msg = parse_json(r#"{"role":"system","content":"Be helpful"}"#).unwrap();
        let tokens = estimate_message_tokens(&msg);
        assert!(tokens > 0);
    }

    #[test]
    fn test_estimate_message_tokens_empty_content() {
        let msg = parse_json(r#"{"role":"user","content":""}"#).unwrap();
        let tokens = estimate_message_tokens(&msg);
        assert_eq!(tokens, 5);
    }

    #[test]
    fn test_compress_with_config_objects() {
        let msg = make_msg("user", "Hello world");
        let json = format!("[{}]", msg);
        let config = r#"{"max_tokens":100,"keep_recent_messages":10,"strategy":"hybrid"}"#;
        let result = compress_messages_impl(&json, config);
        assert!(result.contains("\"compressed_count\":1"));
    }

    #[test]
    fn test_compress_preserves_message_structure() {
        let msgs = vec![
            r#"{"role":"user","content":"Hello","name":"Alice"}"#.to_string(),
            r#"{"role":"assistant","content":"Hi!","name":"Bob"}"#.to_string(),
        ];
        let json = format!("[{}]", msgs.join(","));
        let result = compress_messages_impl(&json, "{}");
        assert!(result.contains("\"Alice\""));
        assert!(result.contains("\"Bob\""));
    }
}
