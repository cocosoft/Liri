// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 统一输出侧护栏契约（13-P2-1，2026-10-05）
 *
 * 背景（`.trae/specs/...` §13 A6 · Agentic Design Patterns 21 模式复查）：
 * 输入侧有 3 套独立检测器（cron 注入 / 工具入参注入 / PromptInjectionDetector）但**无共同接口/注册表**，
 * 输出侧则**完全缺位**（`filterOutput|sanitizeOutput|redactOutput|maskPII|outputGuard` 定向 grep
 * 仅命中日志脱敏）⇒ LLM 生成的敏感内容无运行时拦截。
 *
 * 本层只定义**同步、纯文本**的护栏契约（core 层，零出向依赖）：
 * - 契约与注册表在 core（供任意层消费，不引入 core→app/infra 倒挂）；
 * - 具体护栏实现（复用 `security/*` 既有检测/脱敏原语）在 **app 层**注册（组合根）。
 *
 * 边界（如实 · CS03）：
 * - 只管**同步、无 IO** 的检查/改写；需要 LLM 或事件落盘的**修复**（如 mermaid 重建）不属本契约，
 *   仍由 `chat/finalOutputGuard.ts` 的 remediation 通路承担（本契约不迁入修复）。
 * - 报告原建议的完整 `IGuardrail{phase:'input'|'output'|'tool-call'}` 含输入相位迁移；
 *   本轮按 §13.3 收敛口径**只落地输出相位**，输入侧 3 套检测器不动。
 *
 * 层归属依据：`scripts/modules-to-layers.json`（`core → [core]`）。
 */

/** 护栏处置动作（对齐报告「发现即阻断/打码/询问」：放行 / 打码 / 阻断） */
export type OutputGuardAction = 'pass' | 'redact' | 'block';

/** 护栏命中的单条问题（诊断/审计用；CS02：非用户可见文案） */
export interface OutputGuardIssue {
  /** 产出该问题的护栏名 */
  guard: string;
  severity: 'info' | 'warn' | 'block';
  message: string;
}

/** 单个护栏的判定结果 */
export interface OutputGuardVerdict {
  action: OutputGuardAction;
  /**
   * 处置后文本：
   * - `action==='redact'` ⇒ 改写（打码）后的文本；
   * - `action==='block'` ⇒ 安全替代文本（省略 ⇒ 沿用当前进度文本，由调用方自行处置）。
   */
  text?: string;
  issues: OutputGuardIssue[];
}

/** 输出侧护栏（同步纯函数；实现须自行保证不抛） */
export interface OutputGuard {
  /** 稳定标识（CS02：非用户可见文案，仅用于注册/去重/诊断） */
  readonly name: string;
  /** 执行顺序：**越小越先** */
  readonly priority: number;
  /** 检查并按需改写（不得产生副作用） */
  check(text: string): OutputGuardVerdict;
}

/** 管线执行结果 */
export interface OutputGuardRunResult {
  /** 管线输出文本（经打码改写；被阻断时为阻断点文本/替代文本） */
  text: string;
  /** 是否被阻断（调用方应阻断外发） */
  blocked: boolean;
  /** 阻断原因（`blocked=true` 时非空） */
  blockReason?: string;
  /** 全量命中问题（info/warn/block） */
  issues: OutputGuardIssue[];
  /** 实际改写文本的护栏名（诊断用） */
  redactedBy: string[];
}
