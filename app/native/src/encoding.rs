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

//! 编码检测与转码模块
//!
//! 自动检测文件编码（UTF-8 / GBK / GB18030），
//! 将非 UTF-8 编码的文件内容转为 UTF-8 字符串返回。
//!
//! 检测策略：
//! 1. 先尝试按 UTF-8 解码 → 全部有效则直接返回
//! 2. 无效 → 尝试 GBK 解码，统计替换字符（U+FFFD）比例
//! 3. GBK 替换字符比例过高 → 尝试 GB18030
//! 4. 全部失败 → 按 UTF-8 lossy 解码返回

use std::ffi::{CStr, CString};
use std::fmt::Write;
use std::fs;
use std::os::raw::c_char;

/// 尝试以 GBK 解码字节切片，返回 (解码文本, 替换字符比例)。
fn try_gbk(bytes: &[u8]) -> (String, f64) {
    let mut decoder = encoding_rs::GBK.new_decoder_without_bom_handling();
    let mut output = String::with_capacity(bytes.len());
    let _ = decoder.decode_to_string(bytes, &mut output, false);

    let total = output.chars().count();
    let replacements = output.chars().filter(|&c| c == '\u{FFFD}').count();
    let ratio = if total > 0 {
        replacements as f64 / total as f64
    } else {
        0.0
    };
    (output, ratio)
}

/// 尝试以 GB18030 解码字节切片，返回 (解码文本, 替换字符比例)。
fn try_gb18030(bytes: &[u8]) -> (String, f64) {
    let mut decoder = encoding_rs::GB18030.new_decoder_without_bom_handling();
    let mut output = String::with_capacity(bytes.len());
    let _ = decoder.decode_to_string(bytes, &mut output, false);

    let total = output.chars().count();
    let replacements = output.chars().filter(|&c| c == '\u{FFFD}').count();
    let ratio = if total > 0 {
        replacements as f64 / total as f64
    } else {
        0.0
    };
    (output, ratio)
}

/// 转义字符串中的特殊字符以嵌入 JSON。
fn escape_json(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c < ' ' => {
                write!(out, "\\u{:04x}", c as u32).unwrap();
            }
            c => out.push(c),
        }
    }
    out
}

/// 读取文件并检测编码，返回 JSON 字符串。
///
/// 返回值格式:
/// ```json
/// { "encoding": "utf-8"|"gbk"|"gb18030"|"error",
///   "content": "...",
///   "error": null|"错误信息" }
/// ```
fn read_file_with_encoding_impl(path: &str) -> String {
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) => {
            return format!(
                r#"{{"encoding":"error","content":"","error":"{}"}}"#,
                escape_json(&format!("无法读取文件: {}", e))
            );
        }
    };

    if bytes.is_empty() {
        return r#"{"encoding":"utf-8","content":"","error":null}"#.to_string();
    }

    // Step 1: 尝试 UTF-8 解码
    if let Ok(s) = std::str::from_utf8(&bytes) {
        return format!(
            r#"{{"encoding":"utf-8","content":"{}","error":null}}"#,
            escape_json(s)
        );
    }

    // Step 2: 尝试 GBK 解码
    let (gbk_text, gbk_ratio) = try_gbk(&bytes);
    if gbk_ratio < 0.1 {
        // 替换字符比例 < 10%，认为是有效的 GBK
        return format!(
            r#"{{"encoding":"gbk","content":"{}","error":null}}"#,
            escape_json(&gbk_text)
        );
    }

    // Step 3: 尝试 GB18030 解码
    let (gb18030_text, gb18030_ratio) = try_gb18030(&bytes);
    if gb18030_ratio < 0.1 {
        return format!(
            r#"{{"encoding":"gb18030","content":"{}","error":null}}"#,
            escape_json(&gb18030_text)
        );
    }

    // Step 4: 全部失败，以 UTF-8 lossy 解码返回并报错
    let fallback = String::from_utf8_lossy(&bytes).to_string();
    format!(
        r#"{{"encoding":"utf-8","content":"{}","error":"无法准确检测文件编码（GBK 替换比例 {:.1}%，GB18030 替换比例 {:.1}%），已按 UTF-8 lossy 模式解码"}}"#,
        escape_json(&fallback),
        gbk_ratio * 100.0,
        gb18030_ratio * 100.0
    )
}

// ─── FFI 导出 ───────────────────────────────────────────────

/// 读取文件并自动检测编码。
///
/// # 参数
/// - `path`: 文件路径（C 字符串，UTF-8 编码）
///
/// # 返回值
/// JSON 字符串：`{ "encoding": "...", "content": "...", "error": null|"..." }`
/// 调用方需通过 `py_free_rust_string` 释放返回的字符串。
#[no_mangle]
pub extern "C" fn py_read_file_with_encoding(path: *const c_char) -> *mut c_char {
    let path_str = match unsafe { CStr::from_ptr(path) }.to_str() {
        Ok(s) => s,
        Err(e) => {
            let err = format!(
                r#"{{"encoding":"error","content":"","error":"路径参数不是有效 UTF-8: {}"}}"#,
                e
            );
            return CString::new(err).unwrap_or_default().into_raw();
        }
    };

    let result = read_file_with_encoding_impl(path_str);
    CString::new(result).unwrap_or_default().into_raw()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// 辅助：创建临时文件并返回路径
    fn create_temp_file(content: &[u8]) -> (std::path::PathBuf, std::fs::File) {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let mut dir = std::env::temp_dir();
        dir.push(format!("liri_encoding_test_{}", ts));
        let mut file = std::fs::File::create(&dir).unwrap();
        file.write_all(content).unwrap();
        (dir, file)
    }

    #[test]
    fn test_utf8_content() {
        let text = "Hello, 世界! This is a UTF-8 test.";
        assert!(std::str::from_utf8(text.as_bytes()).is_ok());
    }

    #[test]
    fn test_escape_json_simple() {
        assert_eq!(escape_json("hello"), "hello");
    }

    #[test]
    fn test_escape_json_special_chars() {
        assert_eq!(escape_json("\"hello\\world\n"), "\\\"hello\\\\world\\n");
    }

    #[test]
    fn test_read_file_utf8() {
        let (path, file) = create_temp_file("Hello, 世界!".as_bytes());
        drop(file);

        let result = read_file_with_encoding_impl(path.to_str().unwrap());
        assert!(result.contains("\"encoding\":\"utf-8\""));
        assert!(result.contains("\"content\":\"Hello, 世界!\""));
        assert!(result.contains("\"error\":null"));

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn test_read_file_empty() {
        let (path, file) = create_temp_file("".as_bytes());
        drop(file);

        let result = read_file_with_encoding_impl(path.to_str().unwrap());
        assert!(result.contains("\"encoding\":\"utf-8\""));
        assert!(result.contains("\"content\":\"\""));
        assert!(result.contains("\"error\":null"));

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn test_read_file_not_exist() {
        let result = read_file_with_encoding_impl("Z:\\nonexistent\\file.txt");
        assert!(result.contains("\"encoding\":\"error\""));
        assert!(result.contains("\"error\""));
    }
}
