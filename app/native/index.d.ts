/** Rust 原生模块 FFI 类型声明 */

export interface NativeLib {
  estimateTokens(text: string, model?: string | null): number;
  countTokens(messagesJson: string, model?: string | null): string;
  parseBashForSecurity(command: string): string;
  analyzeBashCommand(command: string): string;
  compressMessages(messagesJson: string, contextJson: string): string;
  estimateCompressionRatio(messagesJson: string): number;
  /** 读取文件并自动检测编码（UTF-8 / GBK / GB18030） */
  readFileWithEncoding(filePath: string): FileReadResult;
  /** 结构闭合求解（Syntax-Aware Compactor · P1）：返回使前缀结构闭合所需的后缀 */
  closeStructure(code: string, lang: string): StructureClosure;
  freeRustString(ptr: unknown): void;
}

/** 结构闭合求解结果（`py_close_structure`） */
export interface StructureClosure {
  ok: boolean;
  lang: string;
  balanced: boolean;
  openCount: number;
  /** 使前缀闭合所需的后缀（如 `) }` 反转后的 `} )`），已闭合为空串 */
  closureSuffix: string;
  /** 未配对的开括号栈 */
  openStack: string[];
}

export interface FileReadResult {
  encoding: "utf-8" | "gbk" | "gb18030" | "error";
  content: string;
  error: string | null;
}

export interface SecurityResult {
  allowed: boolean;
  reason?: string;
  risk_level?: string;
  matched_patterns?: string[];
}

export interface BashAST {
  type: string;
  commands: Array<{
    command: string;
    args: string[];
    redirects?: Array<{ op: string; target: string }>;
  }>;
  dangerous_operations?: string[];
}

export interface TokenCount {
  total: number;
  by_model?: Record<string, number>;
}

declare function loadLibrary(): NativeLib;
export default loadLibrary;
