/** Rust 原生模块 FFI 类型声明 */

export interface NativeLib {
  estimateTokens(text: string, model?: string | null): number;
  countTokens(messagesJson: string, model?: string | null): string;
  parseBashForSecurity(command: string): string;
  analyzeBashCommand(command: string): string;
  compressMessages(messagesJson: string, contextJson: string): string;
  estimateCompressionRatio(messagesJson: string): number;
  freeRustString(ptr: unknown): void;
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
