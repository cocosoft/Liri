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
use crate::json_util::JsonValue;

#[derive(Debug)]
pub struct SimpleCommand {
    pub command: String,
    pub args: Vec<String>,
}

#[derive(Debug)]
pub struct EnvVar {
    pub key: String,
    pub value: String,
}

#[derive(Debug)]
pub struct Redirect {
    pub operator: String,
    pub target: String,
    pub fd: Option<i32>,
}

#[derive(Debug)]
pub enum BashParseKind {
    Simple(SimpleCommand),
    TooComplex,
    ParseUnavailable(String),
}

#[derive(Debug)]
pub struct BashParseResult {
    pub kind: String,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env_vars: Vec<EnvVar>,
    pub redirects: Vec<Redirect>,
    pub error: Option<String>,
}

fn find_matching_quote(s: &str, start: usize, quote: char) -> Option<usize> {
    let bytes = s.as_bytes();
    let mut i = start;
    while i < bytes.len() {
        if bytes[i] == b'\\' && i + 1 < bytes.len() {
            i += 2;
            continue;
        }
        if bytes[i] == quote as u8 {
            return Some(i);
        }
        i += 1;
    }
    None
}

fn parse_simple_command(cmd: &str) -> BashParseResult {
    let trimmed = cmd.trim();
    let mut env_vars = Vec::new();
    let mut redirects = Vec::new();
    let mut tokens = Vec::new();
    let mut i = 0;
    let bytes = trimmed.as_bytes();

    while i < bytes.len() {
        while i < bytes.len() && bytes[i] == b' ' {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }

        if bytes[i] == b'#' {
            break;
        }

        if bytes[i] == b'\'' || bytes[i] == b'"' {
            let quote = bytes[i] as char;
            let start = i;
            i += 1;
            if let Some(end) = find_matching_quote(trimmed, i, quote) {
                let inner = &trimmed[i..end];
                tokens.push(inner.to_string());
                i = end + 1;
            } else {
                tokens.push(trimmed[start..].to_string());
                i = bytes.len();
            }
            continue;
        }

        if bytes[i] == b'<' || bytes[i] == b'>' {
            let start = i;
            let mut op = String::new();
            op.push(bytes[i] as char);
            i += 1;

            if i < bytes.len() {
                match (bytes[start], bytes[i]) {
                    (b'>', b'>') | (b'<', b'<') | (b'>', b'|') | (b'<', b'>') => {
                        op.push(bytes[i] as char);
                        i += 1;
                    }
                    _ => {}
                }
            }

            while i < bytes.len() && bytes[i] == b' ' {
                i += 1;
            }

            let mut target = String::new();
            while i < bytes.len() && bytes[i] != b' ' {
                if bytes[i] == b'#' { break; }
                target.push(bytes[i] as char);
                i += 1;
            }

            let fd = if op.starts_with('>') { Some(1) } else { Some(0) };
            redirects.push(Redirect { operator: op, target, fd });
            continue;
        }

        let mut token = String::new();
        while i < bytes.len() && bytes[i] != b' ' {
            if bytes[i] == b'\'' || bytes[i] == b'"' {
                let quote = bytes[i] as char;
                i += 1;
                if let Some(end) = find_matching_quote(trimmed, i, quote) {
                    token.push_str(&trimmed[i..end]);
                    i = end + 1;
                } else {
                    token.push_str(&trimmed[i..]);
                    i = bytes.len();
                }
            } else if bytes[i] == b'#' {
                break;
            } else {
                token.push(bytes[i] as char);
                i += 1;
            }
        }
        if !token.is_empty() {
            tokens.push(token);
        }
    }

    let mut command = None;
    let mut args = Vec::new();

    for token in tokens {
        if let Some(eq_pos) = token.find('=') {
            if eq_pos > 0 && !token[..eq_pos].contains('/') {
                let key = token[..eq_pos].to_string();
                let value = token[eq_pos + 1..].to_string();
                env_vars.push(EnvVar { key, value });
                continue;
            }
        }

        if command.is_none() {
            command = Some(token);
        } else {
            args.push(token);
        }
    }

    let kind = if command.is_some() { "simple".to_string() } else { "parse_unavailable".to_string() };

    BashParseResult {
        kind,
        command,
        args: if args.is_empty() { None } else { Some(args) },
        env_vars,
        redirects,
        error: None,
    }
}

fn parse_bash_for_security_impl(command: &str) -> String {
    let trimmed = command.trim();

    let has_complex = trimmed.contains("&&") || trimmed.contains("||")
        || trimmed.contains('|') || trimmed.contains(';')
        || (trimmed.contains("if ") || trimmed.contains("while ") || trimmed.contains("for "))
        || trimmed.contains("function ") || trimmed.contains('{') || trimmed.contains('}');

    if has_complex {
        let result = BashParseResult {
            kind: "too_complex".to_string(),
            command: None,
            args: None,
            env_vars: Vec::new(),
            redirects: Vec::new(),
            error: None,
        };
        return result_to_json(&result);
    }

    let result = parse_simple_command(trimmed);

    if result.command.is_none() && result.env_vars.is_empty() && result.redirects.is_empty() {
        return BashParseResult {
            kind: "parse_unavailable".to_string(),
            command: None,
            args: None,
            env_vars: Vec::new(),
            redirects: Vec::new(),
            error: Some("Unable to parse command".to_string()),
        }.let_it_be();
    }

    result_to_json(&result)
}

fn result_to_json(result: &BashParseResult) -> String {
    let kind = JsonValue::String(result.kind.clone());
    let command = match &result.command {
        Some(c) => JsonValue::String(c.clone()),
        None => JsonValue::Null,
    };
    let args = match &result.args {
        Some(a) => JsonValue::Array(a.iter().map(|s| JsonValue::String(s.clone())).collect()),
        None => JsonValue::Null,
    };
    let env_vars: Vec<JsonValue> = result.env_vars.iter().map(|ev| {
        let mut obj = std::collections::BTreeMap::new();
        obj.insert("name".to_string(), JsonValue::String(ev.key.clone()));
        obj.insert("value".to_string(), JsonValue::String(ev.value.clone()));
        JsonValue::Object(obj)
    }).collect();
    let redirects: Vec<JsonValue> = result.redirects.iter().map(|r| {
        let mut obj = std::collections::BTreeMap::new();
        obj.insert("op".to_string(), JsonValue::String(r.operator.clone()));
        obj.insert("target".to_string(), JsonValue::String(r.target.clone()));
        obj.insert("fd".to_string(), match r.fd {
            Some(fd) => JsonValue::Number(fd as f64),
            None => JsonValue::Null,
        });
        JsonValue::Object(obj)
    }).collect();
    let error = match &result.error {
        Some(e) => JsonValue::String(e.clone()),
        None => JsonValue::Null,
    };

    let mut obj = std::collections::BTreeMap::new();
    obj.insert("kind".to_string(), kind);
    obj.insert("command".to_string(), command);
    obj.insert("args".to_string(), args);
    obj.insert("env_vars".to_string(), JsonValue::Array(env_vars));
    obj.insert("redirects".to_string(), JsonValue::Array(redirects));
    obj.insert("error".to_string(), error);

    JsonValue::Object(obj).to_json_string()
}

#[no_mangle]
pub extern "C" fn py_parse_bash_for_security(command: *const c_char) -> *mut c_char {
    let cmd_str = unsafe { CStr::from_ptr(command) }.to_str().unwrap_or("");
    let result = parse_bash_for_security_impl(cmd_str);
    CString::new(result).unwrap_or_default().into_raw()
}

#[no_mangle]
pub extern "C" fn py_free_rust_string(s: *mut c_char) {
    if !s.is_null() {
        unsafe { let _ = CString::from_raw(s); }
    }
}

trait JsonResultExt {
    fn let_it_be(self) -> String;
}

impl JsonResultExt for BashParseResult {
    fn let_it_be(self) -> String {
        result_to_json(&self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_ls() {
        let result = parse_simple_command("ls -la");
        assert_eq!(result.kind, "simple");
        assert_eq!(result.command.as_deref(), Some("ls"));
        assert_eq!(result.args, Some(vec!["-la".to_string()]));
        assert!(result.env_vars.is_empty());
        assert!(result.redirects.is_empty());
    }

    #[test]
    fn test_parse_simple_no_args() {
        let result = parse_simple_command("pwd");
        assert_eq!(result.command.as_deref(), Some("pwd"));
        assert!(result.args.is_none());
    }

    #[test]
    fn test_parse_with_env_var() {
        let result = parse_simple_command("PATH=/usr/bin ls");
        assert_eq!(result.command.as_deref(), Some("ls"));
        assert_eq!(result.env_vars.len(), 1);
        assert_eq!(result.env_vars[0].key, "PATH");
        assert_eq!(result.env_vars[0].value, "/usr/bin");
    }

    #[test]
    fn test_parse_with_redirect_stdout() {
        let result = parse_simple_command("echo hello > output.txt");
        assert_eq!(result.command.as_deref(), Some("echo"));
        assert_eq!(result.redirects.len(), 1);
        assert_eq!(result.redirects[0].operator, ">");
        assert_eq!(result.redirects[0].target, "output.txt");
        assert_eq!(result.redirects[0].fd, Some(1));
    }

    #[test]
    fn test_parse_with_redirect_append() {
        let result = parse_simple_command("echo hello >> output.log");
        assert_eq!(result.redirects.len(), 1);
        assert_eq!(result.redirects[0].operator, ">>");
        assert_eq!(result.redirects[0].target, "output.log");
    }

    #[test]
    fn test_parse_with_redirect_stdin() {
        let result = parse_simple_command("cat < input.txt");
        assert_eq!(result.redirects.len(), 1);
        assert_eq!(result.redirects[0].operator, "<");
        assert_eq!(result.redirects[0].target, "input.txt");
        assert_eq!(result.redirects[0].fd, Some(0));
    }

    #[test]
    fn test_parse_with_quoted_args() {
        let result = parse_simple_command("echo \"hello world\" 'single quoted'");
        assert_eq!(result.command.as_deref(), Some("echo"));
        if let Some(ref args) = result.args {
            assert_eq!(args[0], "hello world");
            assert_eq!(args[1], "single quoted");
        } else {
            panic!("Expected args");
        }
    }

    #[test]
    fn test_parse_empty() {
        let result = parse_simple_command("");
        assert_eq!(result.kind, "parse_unavailable");
    }

    #[test]
    fn test_parse_comment() {
        let result = parse_simple_command("# this is a comment");
        assert_eq!(result.kind, "parse_unavailable");
    }

    #[test]
    fn test_parse_bash_security_simple() {
        let json = parse_bash_for_security_impl("ls -la");
        assert!(json.contains("\"kind\":\"simple\""));
        assert!(json.contains("\"command\":\"ls\""));
    }

    #[test]
    fn test_parse_bash_security_pipe_is_complex() {
        let json = parse_bash_for_security_impl("ls | grep foo");
        assert!(json.contains("\"kind\":\"too_complex\""));
    }

    #[test]
    fn test_parse_bash_security_and_is_complex() {
        let json = parse_bash_for_security_impl("ls && echo done");
        assert!(json.contains("\"kind\":\"too_complex\""));
    }

    #[test]
    fn test_parse_bash_security_redirect() {
        let json = parse_bash_for_security_impl("echo test > file.txt");
        assert!(json.contains("\"kind\":\"simple\""));
        assert!(json.contains("\"op\":\">\""));
        assert!(json.contains("\"target\":\"file.txt\""));
    }

    #[test]
    fn test_parse_bash_security_env_var() {
        let json = parse_bash_for_security_impl("MY_VAR=test env");
        assert!(json.contains("\"name\":\"MY_VAR\""));
        assert!(json.contains("\"value\":\"test\""));
    }

    #[test]
    fn test_parse_bash_security_empty() {
        let json = parse_bash_for_security_impl("");
        assert!(json.contains("\"kind\":\"too_complex\"") || json.contains("\"kind\":\"parse_unavailable\""));
    }

    #[test]
    fn test_parse_bash_security_if_statement() {
        let json = parse_bash_for_security_impl("if [ -f file ]; then echo exists; fi");
        assert!(json.contains("\"kind\":\"too_complex\""));
    }

    #[test]
    fn test_parse_result_to_json_env_vars_format() {
        let result = BashParseResult {
            kind: "simple".to_string(),
            command: Some("cmd".to_string()),
            args: None,
            env_vars: vec![EnvVar { key: "KEY".to_string(), value: "val".to_string() }],
            redirects: vec![],
            error: None,
        };
        let json = result_to_json(&result);
        assert!(json.contains("\"name\":\"KEY\""));
        assert!(json.contains("\"value\":\"val\""));
    }

    #[test]
    fn test_parse_result_to_json_redirects_format() {
        let result = BashParseResult {
            kind: "simple".to_string(),
            command: Some("cmd".to_string()),
            args: None,
            env_vars: vec![],
            redirects: vec![Redirect { operator: ">>".to_string(), target: "log.txt".to_string(), fd: Some(1) }],
            error: None,
        };
        let json = result_to_json(&result);
        assert!(json.contains("\"op\":\">>\""));
        assert!(json.contains("\"target\":\"log.txt\""));
        assert!(json.contains("\"fd\":1"));
    }

    #[test]
    fn test_parse_with_multiple_env_vars() {
        let result = parse_simple_command("A=1 B=2 C=3 command");
        assert_eq!(result.env_vars.len(), 3);
        assert_eq!(result.env_vars[0].key, "A");
        assert_eq!(result.env_vars[1].key, "B");
        assert_eq!(result.env_vars[2].key, "C");
        assert_eq!(result.command.as_deref(), Some("command"));
    }

    #[test]
    fn test_parse_with_multiple_redirects() {
        let result = parse_simple_command("cmd < input.txt > output.txt");
        assert_eq!(result.redirects.len(), 2);
    }
}
