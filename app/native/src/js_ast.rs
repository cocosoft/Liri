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

//! js_ast —— 基于 **SWC** 的 JS/TS **CallExpression 深度扫描 + 特征拦截器**（原生侧）
//!
//! 规格：`.trae/specs/ast-family-phased-plan.md` §3-P2（**用户 2026-10-09 裁定：启动 P2**，
//! 覆盖 `runtime-ast-guardrail-assessment.md` B7「不立项」）。
//!
//! 职责：对**已通过静态门禁**的编排代码做**语义级**复核 —— 用真解析器枚举**所有**
//! `CallExpr`（含 `globalThis['eval']` 这类**计算成员/混淆形态**），按特征表判定风险等级。
//! 与 TS 侧既有正则（`SENSITIVE_GLOBAL_RE` / `IMPORT_META_REQUIRE_RE`）**互补**：正则挡形态，
//! 本层挡"正则看不见的等价写法"。
//!
//! 边界（如实 · CS03）：**只判、不阻断**（advisory）。调用方决定拦截策略；本函数无副作用。

use std::collections::BTreeMap;
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

use swc_common::sync::Lrc;
use swc_common::{FileName, SourceMap, Spanned};
use swc_ecma_ast::{Callee, CallExpr, EsVersion, Expr, Lit, MemberProp, NewExpr};
use swc_ecma_parser::{lexer::Lexer, Parser, StringInput, Syntax, TsSyntax};
use swc_ecma_visit::{Visit, VisitWith};

use crate::json_util::JsonValue;

/// 特征表：危险调用名（**精确匹配** callee 的解析名）
const DANGEROUS_CALLS: &[&str] = &[
    // 任意代码执行
    "eval",
    "Function",
    "vm.runInThisContext",
    "vm.runInNewContext",
    "vm.runInContext",
    "vm.Script",
    "vm.compileFunction",
    // 进程/模块（可绕过静态 import 门禁）
    "require",
    "process.exit",
    "process.abort",
    "process.kill",
    "process.binding",
    "process.dlopen",
    // 子进程
    "child_process.exec",
    "child_process.execSync",
    "child_process.spawn",
    "child_process.spawnSync",
    "child_process.fork",
    // Bun 专有
    "Bun.spawn",
    "Bun.spawnSync",
    "Bun.$",
];

/// 特征表：可疑调用名（探索型：网络/文件破坏/解释器）
const SUSPICIOUS_CALLS: &[&str] = &[
    "fetch",
    "WebSocket",
    "http.request",
    "https.request",
    "net.connect",
    "net.createConnection",
    "dgram.createSocket",
    "fs.unlink",
    "fs.unlinkSync",
    "fs.rm",
    "fs.rmSync",
    "fs.rmdir",
    "fs.rmdirSync",
    "fs.writeFile",
    "fs.writeFileSync",
    "fs.appendFile",
    "fs.appendFileSync",
    "fs.chmod",
    "fs.chmodSync",
    "fs.chown",
    "fs.truncate",
    "Deno.run",
    "Deno.Command",
    "Bun.write",
];

/// 可作为"全局对象"的载体 —— 用于识别 `globalThis['eval']` 这类**计算成员**混淆形态
const GLOBAL_CARRIERS: &[&str] = &["globalThis", "window", "global", "self"];

fn severity_of(name: &str) -> Option<&'static str> {
    if DANGEROUS_CALLS.contains(&name) {
        return Some("dangerous");
    }
    if SUSPICIOUS_CALLS.contains(&name) {
        return Some("suspicious");
    }
    None
}

/// 解析表达式为**点分名**（`process.exit` / `child_process.exec` / `globalThis.eval`）。
///
/// 计算成员（`a['b']`）里的**字符串字面量**照常拼名 ⇒ `globalThis['eval']` 亦得 `globalThis.eval`。
fn expr_name(expr: &Expr) -> Option<String> {
    match expr {
        Expr::Ident(id) => Some(id.sym.to_string()),
        Expr::This(_) => Some("this".to_string()),
        Expr::Paren(p) => expr_name(&p.expr),
        Expr::Member(m) => {
            let obj = expr_name(&m.obj)?;
            let prop = match &m.prop {
                MemberProp::Ident(i) => i.sym.to_string(),
                MemberProp::Computed(c) => match &*c.expr {
                    // swc_atoms::Atom 的 Str.value 为 Wtf8Atom ⇒ 用 lossy 转 String（无 Display）
                    Expr::Lit(Lit::Str(s)) => s.value.to_string_lossy().to_string(),
                    _ => return None,
                },
                MemberProp::PrivateName(_) => return None,
            };
            Some(format!("{}.{}", obj, prop))
        }
        _ => None,
    }
}

/// 一个命中项
struct Hit {
    callee: String,
    severity: &'static str,
    kind: &'static str,
    line: u32,
}

struct CallScan<'a> {
    cm: &'a SourceMap,
    call_count: usize,
    hits: Vec<Hit>,
}

impl<'a> CallScan<'a> {
    fn line_of(&self, span: swc_common::Span) -> u32 {
        self.cm.lookup_char_pos(span.lo()).line as u32
    }

    fn classify(&mut self, name: &str, computed: bool, line: u32) {
        // ① 直接命中特征表
        if let Some(sev) = severity_of(name) {
            self.hits.push(Hit {
                callee: name.to_string(),
                severity: sev,
                kind: "rule",
                line,
            });
            return;
        }
        // ② 计算成员 / 全局载体上的"裸危险名"（如 globalThis['eval']、globalThis.eval）
        if let Some((carrier, tail)) = name.split_once('.') {
            if computed || GLOBAL_CARRIERS.contains(&carrier) {
                if let Some(sev) = severity_of(tail) {
                    self.hits.push(Hit {
                        callee: name.to_string(),
                        severity: sev,
                        kind: "computed-member",
                        line,
                    });
                }
            }
        }
    }
}

impl<'a> Visit for CallScan<'a> {
    fn visit_call_expr(&mut self, n: &CallExpr) {
        self.call_count += 1;
        let line = self.line_of(n.span());

        match &n.callee {
            Callee::Expr(e) => {
                if let Some(name) = expr_name(e) {
                    // 是否通过计算成员访问（`a['b']`）—— 混淆迹象
                    let computed = matches!(&**e, Expr::Member(m) if matches!(m.prop, MemberProp::Computed(_)));
                    self.classify(&name, computed, line);
                }
            }
            Callee::Import(_) => {
                self.hits.push(Hit {
                    callee: "import".to_string(),
                    severity: "dangerous",
                    kind: "dynamic-import",
                    line,
                });
            }
            Callee::Super(_) => {}
        }

        n.visit_children_with(self);
    }

    /// `new X(...)` —— **构造调用**也是危险面（`new Function('...')` 即 `eval` 等价物、
    /// `new vm.Script` / `new WebSocket` / `new Deno.Command`）。与 `CallExpr` 同表判定。
    fn visit_new_expr(&mut self, n: &NewExpr) {
        let line = self.line_of(n.span());
        if let Some(name) = expr_name(&n.callee) {
            let computed = matches!(&*n.callee, Expr::Member(m) if matches!(m.prop, MemberProp::Computed(_)));
            self.classify(&name, computed, line);
        }
        n.visit_children_with(self);
    }
}

fn scan_impl(code: &str) -> String {
    let cm: Lrc<SourceMap> = Default::default();
    let fm = cm.new_source_file(FileName::Anon.into(), code.to_string());

    let lexer = Lexer::new(
        Syntax::Typescript(TsSyntax::default()),
        EsVersion::latest(),
        StringInput::from(&*fm),
        None,
    );
    let mut parser = Parser::new_from(lexer);

    match parser.parse_module() {
        Ok(module) => {
            let mut scan = CallScan {
                cm: &cm,
                call_count: 0,
                hits: Vec::new(),
            };
            module.visit_with(&mut scan);

            let risk = if scan.hits.iter().any(|h| h.severity == "dangerous") {
                "dangerous"
            } else if scan.hits.iter().any(|h| h.severity == "suspicious") {
                "suspicious"
            } else {
                "safe"
            };

            let matches: Vec<JsonValue> = scan
                .hits
                .iter()
                .map(|h| {
                    let mut o = BTreeMap::new();
                    o.insert("callee".to_string(), JsonValue::String(h.callee.clone()));
                    o.insert(
                        "severity".to_string(),
                        JsonValue::String(h.severity.to_string()),
                    );
                    o.insert("kind".to_string(), JsonValue::String(h.kind.to_string()));
                    o.insert("line".to_string(), JsonValue::Number(h.line as f64));
                    JsonValue::Object(o)
                })
                .collect();

            let mut obj = BTreeMap::new();
            obj.insert("ok".to_string(), JsonValue::Bool(true));
            obj.insert(
                "engine".to_string(),
                JsonValue::String("swc".to_string()),
            );
            obj.insert(
                "callCount".to_string(),
                JsonValue::Number(scan.call_count as f64),
            );
            obj.insert(
                "risk".to_string(),
                JsonValue::String(risk.to_string()),
            );
            obj.insert("matches".to_string(), JsonValue::Array(matches));
            JsonValue::Object(obj).to_json_string()
        }
        Err(err) => {
            let mut obj = BTreeMap::new();
            obj.insert("ok".to_string(), JsonValue::Bool(false));
            obj.insert(
                "engine".to_string(),
                JsonValue::String("swc".to_string()),
            );
            obj.insert(
                "error".to_string(),
                JsonValue::String(format!("{:?}", err.kind())),
            );
            JsonValue::Object(obj).to_json_string()
        }
    }
}

/// FFI：`py_scan_js_calls(code) -> *mut c_char`（返回 JSON；由 `py_free_rust_string` 释放）
///
/// JSON 形状：
/// - 成功：`{ ok:true, engine:"swc", callCount:N, risk:"safe|suspicious|dangerous", matches:[{callee,severity,kind,line}] }`
/// - 失败：`{ ok:false, engine:"swc", error:"<解析错误>" }`
#[no_mangle]
pub extern "C" fn py_scan_js_calls(code: *const c_char) -> *mut c_char {
    let src = unsafe { CStr::from_ptr(code) }.to_str().unwrap_or("");
    let result = scan_impl(src);
    CString::new(result).unwrap_or_default().into_raw()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json_risk(code: &str) -> String {
        let json = scan_impl(code);
        let v = crate::json_util::parse_json(&json).expect("valid json");
        v.get("risk")
            .and_then(|r| r.as_str())
            .unwrap_or("(missing)")
            .to_string()
    }

    fn json_matches_count(code: &str) -> usize {
        let json = scan_impl(code);
        let v = crate::json_util::parse_json(&json).expect("valid json");
        v.get("matches")
            .and_then(|m| m.as_array())
            .map(|a| a.len())
            .unwrap_or(0)
    }

    #[test]
    fn test_safe_code() {
        assert_eq!(json_risk("const x = 1 + 2; console.log(x);"), "safe");
        assert_eq!(json_matches_count("const x = 1;"), 0);
    }

    #[test]
    fn test_direct_eval_dangerous() {
        assert_eq!(json_risk("eval('1+1');"), "dangerous");
    }

    #[test]
    fn test_function_constructor_dangerous() {
        assert_eq!(json_risk("const f = new Function('return 1');"), "dangerous");
    }

    #[test]
    fn test_process_exit_dangerous() {
        assert_eq!(json_risk("process.exit(1);"), "dangerous");
    }

    #[test]
    fn test_child_process_dangerous() {
        assert_eq!(
            json_risk("child_process.execSync('rm -rf /');"),
            "dangerous"
        );
    }

    /// 关键用例：**正则看不见的等价写法** —— 计算成员 + 全局载体
    #[test]
    fn test_computed_member_obfuscation_dangerous() {
        assert_eq!(json_risk("globalThis['eval']('1+1');"), "dangerous");
    }

    #[test]
    fn test_computed_member_process_dangerous() {
        assert_eq!(json_risk("globalThis['process']['exit'](1);"), "dangerous");
    }

    #[test]
    fn test_fetch_suspicious() {
        assert_eq!(json_risk("fetch('http://x');"), "suspicious");
    }

    #[test]
    fn test_fs_unlink_suspicious() {
        assert_eq!(json_risk("fs.unlinkSync('/tmp/a');"), "suspicious");
    }

    #[test]
    fn test_dynamic_import_dangerous() {
        assert_eq!(json_risk("const m = import('fs');"), "dangerous");
    }

    #[test]
    fn test_typescript_parses() {
        // TS 语法（类型注解）应能解析，且不误报
        assert_eq!(json_risk("const x: number = 1; const y = x + 1;"), "safe");
    }

    #[test]
    fn test_member_call_not_in_table_is_safe() {
        assert_eq!(json_risk("console.log('hi'); Math.max(1, 2);"), "safe");
    }

    #[test]
    fn test_parse_error_reports_not_ok() {
        let json = scan_impl("const = ;");
        let v = crate::json_util::parse_json(&json).expect("valid json");
        assert_eq!(v.get("ok").and_then(|b| b.as_bool()), Some(false));
    }

    #[test]
    fn test_call_count_tracked() {
        let json = scan_impl("a(); b(); c();");
        let v = crate::json_util::parse_json(&json).expect("valid json");
        assert_eq!(v.get("callCount").and_then(|n| n.as_i64()), Some(3));
    }
}
