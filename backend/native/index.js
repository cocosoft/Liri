const { dlopen, FFIType, suffix, CString } = require("bun:ffi");
const path = require("path");
const os = require("os");

function loadLibrary() {
  const isWindows = os.platform() === "win32";
  const libName = isWindows ? "py_app_native.dll" : `libpy_app_native.${suffix}`;
  const libPath = path.join(__dirname, "target", "release", libName);

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
    };
  } catch (err) {
    console.warn("[native] Failed to load Rust native library:", err.message);
    return null;
  }
}

const native = loadLibrary();

module.exports = native;
