const { dlopen, FFIType, suffix, CString } = require("bun:ffi");
const os = require("os");
const { nativeLibCandidates } = require("./loaderPaths");

function loadLibrary() {
  // T25-09（2026-10-25）：候选路径见 `loaderPaths.js`（显式覆盖 → 包根 target/release →
  // native/ 子目录 → 仓库根的 native/）。原实现只看 `__dirname/target/release`，
  // 发布包里该目录不存在 ⇒ 永远降级 JS 且只有一句无上下文的 warn。
  const candidates = nativeLibCandidates({
    platform: os.platform(),
    suffix,
    dirname: __dirname,
    cwd: process.cwd(),
    env: process.env,
  });

  let lastError = null;
  for (const libPath of candidates) {
    try {
      const lib = dlopen(libPath, {
      py_estimate_tokens: {
        args: [FFIType.cstring, FFIType.cstring],
        returns: FFIType.i32,
      },
      py_count_tokens: {
        args: [FFIType.cstring, FFIType.cstring],
        returns: FFIType.ptr,
      },
      py_parse_bash_for_security: {
        args: [FFIType.cstring],
        returns: FFIType.ptr,
      },
      py_analyze_bash_command: {
        args: [FFIType.cstring],
        returns: FFIType.ptr,
      },
      py_compress_messages: {
        args: [FFIType.cstring, FFIType.cstring],
        returns: FFIType.ptr,
      },
      py_estimate_compression_ratio: {
        args: [FFIType.cstring],
        returns: FFIType.f64,
      },
      py_read_file_with_encoding: {
        args: [FFIType.cstring],
        returns: FFIType.ptr,
      },
      py_scan_js_calls: {
        args: [FFIType.cstring],
        returns: FFIType.ptr,
      },
      py_close_structure: {
        args: [FFIType.cstring, FFIType.cstring],
        returns: FFIType.ptr,
      },
      py_free_rust_string: {
        args: [FFIType.ptr],
        returns: FFIType.void,
      },
    });

    const symbols = lib.symbols;

    function toBuffer(s) {
      return Buffer.from(s + "\0", "utf-8");
    }

    function readCString(ptr) {
      if (!ptr) return null;
      const result = new CString(ptr).toString();
      symbols.py_free_rust_string(ptr);
      return result;
    }

    return {
      estimateTokens(text, model) {
        return symbols.py_estimate_tokens(toBuffer(text), model ? toBuffer(model) : null);
      },

      countTokens(messagesJson, model) {
        const ptr = symbols.py_count_tokens(
          toBuffer(messagesJson),
          model ? toBuffer(model) : null
        );
        const result = readCString(ptr);
        return result ? JSON.parse(result) : null;
      },

      parseBashForSecurity(command) {
        const ptr = symbols.py_parse_bash_for_security(toBuffer(command));
        const result = readCString(ptr);
        return result ? JSON.parse(result) : null;
      },

      analyzeBashCommand(command) {
        const ptr = symbols.py_analyze_bash_command(toBuffer(command));
        const result = readCString(ptr);
        return result ? JSON.parse(result) : null;
      },

      compressMessages(messagesJson, configJson) {
        const ptr = symbols.py_compress_messages(
          toBuffer(messagesJson),
          toBuffer(configJson || "{}")
        );
        const result = readCString(ptr);
        return result ? JSON.parse(result) : null;
      },

      estimateCompressionRatio(messagesJson) {
        return symbols.py_estimate_compression_ratio(toBuffer(messagesJson));
      },

      /**
       * 读取文件并自动检测编码（UTF-8 / GBK / GB18030）。
       * @param {string} filePath - 文件路径
       * @returns {{ encoding: string, content: string, error: string|null }}
       */
      readFileWithEncoding(filePath) {
        const ptr = symbols.py_read_file_with_encoding(toBuffer(filePath));
        const result = readCString(ptr);
        return result ? JSON.parse(result) : { encoding: "error", content: "", error: "FFI 调用返回空" };
      },

      /**
       * 基于 SWC 的 JS/TS **CallExpression 深度扫描 + 特征拦截**（原生侧）。
       * 规格：`.trae/specs/ast-family-phased-plan.md` §3-P2。
       * @param {string} code - 待扫描的 JS/TS 源码
       * @returns {{ok:boolean, engine?:string, callCount?:number, risk?:string,
       *            matches?:Array<{callee:string,severity:string,kind:string,line:number}>,
       *            error?:string} | null}
       */
      scanJsCalls(code) {
        const ptr = symbols.py_scan_js_calls(toBuffer(code));
        const result = readCString(ptr);
        return result ? JSON.parse(result) : null;
      },

      /**
       * 结构闭合求解（Syntax-Aware Compactor · P1）。
       * 规格：`dev_docs/20261010/AST语法觉知型上下文回收引擎-设计方案-20261010.md` §4。
       * @param {string} code - 可能被截断的代码/文本
       * @param {string} lang - 语言提示（'ts'/'js'/'py'/'text'…；未知按 text 处理）
       * @returns {{ok:boolean, lang:string, balanced:boolean, openCount:number,
       *            closureSuffix:string, openStack:string[]} | null}
       */
      closeStructure(code, lang) {
        const ptr = symbols.py_close_structure(
          toBuffer(code),
          toBuffer(lang || "text")
        );
        const result = readCString(ptr);
        return result ? JSON.parse(result) : null;
      },
    };
    } catch (err) {
      lastError = err;
    }
  }

  // T25-09（2026-10-25）：**显式告警** —— 带上平台与"找过哪些路径"，
  // 让"发布包缺库 ⇒ 静默降级"变成可诊断事实（`[native] UNAVAILABLE` 可被日志检索）。
  console.warn(
    "[native] UNAVAILABLE — Rust 原生库加载失败，已降级为 JS 实现（功能不受影响，性能下降）",
    {
      platform: os.platform(),
      searched: candidates,
      error: lastError ? lastError.message : "未尝试任何路径（候选为空）",
    }
  );
  return null;
}

const native = loadLibrary();

module.exports = native;
