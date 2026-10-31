/**
 * LSP 工具面（轨 A）的结构校验 —— 2026-10-31（S6 第一步：摘掉对轨 B `app/src/lsp` 的依赖）。
 *
 * **背景**：轨 B（`app/src/lsp/**`）原本还有一处生产消费者 —— 本目录的
 * `LSPToolIntegration` 借用它的 4 个 zod 校验器。侧车（`tools/sidecar/lspConnection.ts`）
 * 自带连接层、并不使用轨 B，因此把校验下沉到工具面后，轨 B 就**零静态消费者**，
 * 才可能进入 CD05 的「摘入口 → 观察 → 再删实现」流程。
 *
 * **口径**：与轨 B `lsp/schemas.ts` 的 zod 约束逐条对齐（Position/Range/Location/Diagnostic），
 * 但不引入 zod 与全局缓存 —— 入参来自 LSP 响应，量级小，且这里更看重"无共享可变状态"。
 */
import type { Diagnostic, Location, Position, Range } from './types/index.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** LSP 的 `line` / `character` 均为从 0 起的整数 */
function isNonNegativeInt(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** 与轨 B 的 `z.string().url()` 同口径：必须是可解析的绝对 URL */
function isUriLike(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function validatePosition(position: unknown): position is Position {
  return (
    isRecord(position) &&
    isNonNegativeInt(position.line) &&
    isNonNegativeInt(position.character)
  );
}

export function validateRange(range: unknown): range is Range {
  return (
    isRecord(range) &&
    validatePosition(range.start) &&
    validatePosition(range.end)
  );
}

export function validateLocation(location: unknown): location is Location {
  return (
    isRecord(location) &&
    isUriLike(location.uri) &&
    validateRange(location.range)
  );
}

/** severity 1–4（LSP DiagnosticSeverity）、code 为 string|number、source 为 string */
export function validateDiagnostic(
  diagnostic: unknown
): diagnostic is Diagnostic {
  if (!isRecord(diagnostic)) return false;
  if (!validateRange(diagnostic.range)) return false;
  if (typeof diagnostic.message !== 'string') return false;
  const severity = diagnostic.severity;
  if (
    severity !== undefined &&
    !(
      typeof severity === 'number' &&
      Number.isInteger(severity) &&
      severity >= 1 &&
      severity <= 4
    )
  ) {
    return false;
  }
  const code = diagnostic.code;
  if (
    code !== undefined &&
    typeof code !== 'string' &&
    typeof code !== 'number'
  ) {
    return false;
  }
  if (
    diagnostic.source !== undefined &&
    typeof diagnostic.source !== 'string'
  ) {
    return false;
  }
  return true;
}
