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

//! structure —— **结构闭合**求解（Syntax-Aware Compactor · P1，2026-10-10）
//!
//! 规格：`dev_docs/20261010/AST语法觉知型上下文回收引擎-设计方案-20261010.md` §4（P1）。
//!
//! 职责：给定**可能被字符级截断**的代码/文本，计算**使其结构闭合所需的后缀**（未配对的
//! `{ [ (` 按 LIFO 反转成 `} ] )`），供 TS 侧在"安全预览/裁剪"时补齐。
//!
//! **为何用词法级而非 SWC AST**（与规格的偏差 + 理由，如实）：截断后的代码**本就是不完整
//! 的**，SWC 会解析失败 ⇒ 无法据此计算闭合。故此处用**语言无关的括号栈 + 引号/注释感知**的
//! 单趟扫描（纯词法），对**任意前缀**都稳定可用。仅保证**括号/引号结构**闭合，**不做**作用域/
//! 符号树（后者维持 `ast-family-phased-plan.md §8.2` G-C 的不立项口径）。
//!
//! 边界（如实）：对纯文本（`lang=text`/未知）**不解析引号/注释**，仅数括号；误判只影响"补多少
//! 闭括号"，不改变已保留正文。

use std::ffi::{CStr, CString};
use std::os::raw::c_char;

use crate::json_util::JsonValue;

/// 语言档案（决定引号 / 注释语法）
struct Profile {
    /// 是否按代码处理（引号 = 字符串定界）
    code_like: bool,
    /// 行注释前缀（""=无）
    line_comment: &'static str,
    /// 是否支持 `/* */` 块注释
    block_comment: bool,
}

fn profile_for(lang: &str) -> Profile {
    let l = lang.trim().to_ascii_lowercase();
    let code_like = matches!(
        l.as_str(),
        "js" | "javascript"
            | "ts" | "typescript"
            | "tsx" | "jsx"
            | "json"
            | "java"
            | "c" | "cpp" | "c++" | "cs" | "csharp"
            | "go" | "golang"
            | "rust" | "rs"
            | "swift"
            | "kt" | "kotlin"
            | "scala"
            | "php"
            | "py" | "python"
            | "rb" | "ruby"
            | "lua"
            | "dart"
            | "sh" | "bash" | "zsh" | "ps1" | "powershell"
            | "sql"
    );
    if !code_like {
        return Profile {
            code_like: false,
            line_comment: "",
            block_comment: false,
        };
    }
    let (line_comment, block_comment) = match l.as_str() {
        "py" | "python" | "rb" | "ruby" | "sh" | "bash" | "zsh" => ("#", false),
        "sql" => ("--", false),
        _ => ("//", true),
    };
    Profile {
        code_like,
        line_comment,
        block_comment,
    }
}

/// 括号栈 + 引号/注释感知的单趟扫描；返回（未配对开括号栈, 是否闭合）
fn scan_stack(code: &str, p: &Profile) -> (Vec<char>, bool) {
    let chars: Vec<char> = code.chars().collect();
    let n = chars.len();
    let mut stack: Vec<char> = Vec::new();
    let mut i = 0usize;

    #[derive(PartialEq)]
    enum St {
        Normal,
        LineComment,
        BlockComment,
        Str(char),
    }
    let mut st = St::Normal;

    while i < n {
        let c = chars[i];
        match st {
            St::Normal => {
                if !p.line_comment.is_empty() && starts_with(&chars, i, p.line_comment) {
                    st = St::LineComment;
                    i += p.line_comment.len();
                    continue;
                }
                if p.block_comment && c == '/' && i + 1 < n && chars[i + 1] == '*' {
                    st = St::BlockComment;
                    i += 2;
                    continue;
                }
                if p.code_like && (c == '"' || c == '\'' || c == '`') {
                    st = St::Str(c);
                    i += 1;
                    continue;
                }
                match c {
                    '{' | '[' | '(' => stack.push(c),
                    '}' => pop_if(&mut stack, '{'),
                    ']' => pop_if(&mut stack, '['),
                    ')' => pop_if(&mut stack, '('),
                    _ => {}
                }
                i += 1;
            }
            St::Str(q) => {
                if c == '\\' {
                    i += 2;
                    continue;
                }
                if c == q {
                    st = St::Normal;
                }
                i += 1;
            }
            St::LineComment => {
                if c == '\n' {
                    st = St::Normal;
                }
                i += 1;
            }
            St::BlockComment => {
                if c == '*' && i + 1 < n && chars[i + 1] == '/' {
                    st = St::Normal;
                    i += 2;
                    continue;
                }
                i += 1;
            }
        }
    }

    let balanced = stack.is_empty();
    (stack, balanced)
}

fn starts_with(chars: &[char], at: usize, pat: &str) -> bool {
    let p: Vec<char> = pat.chars().collect();
    if at + p.len() > chars.len() {
        return false;
    }
    chars[at..at + p.len()] == p[..]
}

/// 仅当栈顶匹配该开括号时弹出（乱序闭括号不误弹）
fn pop_if(stack: &mut Vec<char>, open: char) {
    if stack.last() == Some(&open) {
        stack.pop();
    }
}

fn closer_of(open: char) -> char {
    match open {
        '{' => '}',
        '[' => ']',
        '(' => ')',
        _ => ' ',
    }
}

/// 核心实现（供 FFI 与单测复用）：返回 JSON 字符串
pub fn close_structure_impl(code: &str, lang: &str) -> String {
    let p = profile_for(lang);
    let (stack, balanced) = scan_stack(code, &p);

    // 未配对开括号 ⇒ LIFO 反转成闭括号后缀
    let mut suffix = String::new();
    for open in stack.iter().rev() {
        let c = closer_of(*open);
        if c != ' ' {
            suffix.push(c);
        }
    }

    let mut obj = std::collections::BTreeMap::new();
    obj.insert("ok".to_string(), JsonValue::Bool(true));
    obj.insert("lang".to_string(), JsonValue::String(lang.to_string()));
    obj.insert("balanced".to_string(), JsonValue::Bool(balanced));
    obj.insert(
        "openCount".to_string(),
        JsonValue::Number(stack.len() as f64),
    );
    obj.insert("closureSuffix".to_string(), JsonValue::String(suffix));
    obj.insert(
        "openStack".to_string(),
        JsonValue::Array(
            stack
                .iter()
                .map(|c| JsonValue::String(c.to_string()))
                .collect(),
        ),
    );
    JsonValue::Object(obj).to_json_string()
}

/// FFI：`py_close_structure(code, lang) -> *mut c_char`（返回 JSON；由 `py_free_rust_string` 释放）
///
/// JSON 形状：`{ ok:true, lang, balanced:bool, openCount:N, closureSuffix:"", openStack:["{","("] }`
#[no_mangle]
pub extern "C" fn py_close_structure(
    code: *const c_char,
    lang: *const c_char,
) -> *mut c_char {
    let src = unsafe { CStr::from_ptr(code) }.to_str().unwrap_or("");
    let lang_s = if lang.is_null() {
        ""
    } else {
        unsafe { CStr::from_ptr(lang) }.to_str().unwrap_or("")
    };
    let result = close_structure_impl(src, lang_s);
    CString::new(result).unwrap_or_default().into_raw()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json_util::parse_json;

    fn suffix(code: &str, lang: &str) -> String {
        let json = close_structure_impl(code, lang);
        let v = parse_json(&json).expect("valid json");
        v.get("closureSuffix")
            .and_then(|s| s.as_str())
            .unwrap_or("(missing)")
            .to_string()
    }

    fn balanced(code: &str, lang: &str) -> bool {
        let json = close_structure_impl(code, lang);
        let v = parse_json(&json).expect("valid json");
        v.get("balanced").and_then(|s| s.as_bool()).unwrap_or(false)
    }

    #[test]
    fn balanced_code_has_empty_suffix() {
        assert_eq!(suffix("function f() { return 1; }", "ts"), "");
        assert!(balanced("function f() { return 1; }", "ts"));
    }

    #[test]
    fn truncated_block_needs_closing_brace() {
        assert_eq!(suffix("function f() {\n  const a = 1;", "ts"), "}");
        assert!(!balanced("function f() {\n  const a = 1;", "ts"));
    }

    #[test]
    fn nested_stack_lifo_suffix() {
        // f({[ ⇒ 未配对栈 ['(','{','['] ⇒ 反转闭括号 "]})"
        assert_eq!(suffix("f({[", "js"), "]})");
    }

    #[test]
    fn brackets_inside_string_ignored() {
        // 字符串内的 ) 不参与配对
        assert_eq!(suffix("f(\",)\", 1", "js"), ")");
    }

    #[test]
    fn brackets_inside_line_comment_ignored() {
        assert_eq!(suffix("f( // 三个 ((( 注释\n  1", "js"), ")");
        assert_eq!(suffix("f( # ((( \n", "py"), ")");
    }

    #[test]
    fn brackets_inside_block_comment_ignored() {
        assert_eq!(suffix("f( /* ))) */ 1", "js"), ")");
    }

    #[test]
    fn plain_text_does_not_parse_quotes() {
        // 纯文本（lang=text）：撇号不当字符串 ⇒ 括号照常计数
        assert!(balanced("it's (ok)", "text"));
        assert_eq!(suffix("it's (ok", "text"), ")");
    }

    #[test]
    fn out_of_order_closer_not_popped() {
        // `{[}` 中 `}` 与栈顶 `[` 不匹配 ⇒ 不误弹 ⇒ 栈仍 ['{','['] ⇒ 后缀 "]}"`
        assert_eq!(suffix("{[}", "js"), "]}");
    }

    #[test]
    fn escape_in_string() {
        assert_eq!(suffix(r#"f("a\")"#, "js"), ")");
    }
}
