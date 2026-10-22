// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * replyEffort.ts — 回复详略档契约（`/effort` 后端接线，2026-10-22）
 *
 * **事实来源**：会话 `metadata.effortLevel`（由 `/effort` 命令写入）。
 * 对齐 `workMode.ts` 的既有形态 —— 本模块只承担两件事：
 *
 *  ① **取值归一化**：`normalizeReplyEffort()` —— 非法值/未设置一律回落 `auto`
 *     （`auto` = 不注入任何指令 ⇒ 行为与接线前完全一致）；
 *  ② **档位 → 系统提示片段**：`buildReplyEffortPrompt()`，
 *     以及**预留**的思考预算 `resolveEffortThinkingBudget()`（随 metadata 落库备用，
 *     当前 provider 层尚未消费 —— 见第二步接线）。
 */

import { EFFORT_TO_BUDGET } from '@modules/ai';

/** 回复详略档（与 `/effort` 命令的入参一致） */
export type ReplyEffortLevel = 'low' | 'medium' | 'high' | 'auto';

/** 全部合法取值（供命令侧校验/提示用） */
export const REPLY_EFFORT_LEVELS: readonly ReplyEffortLevel[] = [
  'low',
  'medium',
  'high',
  'auto',
];

/** 默认档：不注入指令 */
export const DEFAULT_REPLY_EFFORT: ReplyEffortLevel = 'auto';

/** 取值校验（用于命令/HTTP 等外部输入） */
export function isReplyEffortLevel(value: unknown): value is ReplyEffortLevel {
  return (
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'auto'
  );
}

/**
 * 归一化：大小写/空白无关；非法值或非字符串 ⇒ {@link DEFAULT_REPLY_EFFORT}。
 * **不抛错**：元数据可能来自历史会话或外部写入，静默回落默认档比让对话失败更合理。
 */
export function normalizeReplyEffort(value: unknown): ReplyEffortLevel {
  if (typeof value !== 'string') return DEFAULT_REPLY_EFFORT;
  const normalized = value.trim().toLowerCase();
  return isReplyEffortLevel(normalized) ? normalized : DEFAULT_REPLY_EFFORT;
}

/** 三档的提示片段（`auto` 不在其中 —— 它表示"不注入"） */
const EFFORT_PROMPTS: Record<'low' | 'medium' | 'high', string> = {
  low: [
    '【回复详略：精简】',
    '优先给结论与最少必要信息：不展开推导、不复述需求；',
    '除非用户明确要求，不列长清单、不补充背景。',
  ].join('\n'),
  medium: [
    '【回复详略：标准】',
    '先给结论，再给必要依据；按问题复杂度取舍细节，控制篇幅。',
  ].join('\n'),
  high: [
    '【回复详略：详尽】',
    '给出完整推导、边界条件与风险；必要时补充替代方案与验证方式。',
  ].join('\n'),
};

/**
 * 档位 → 系统提示片段。
 * `auto` / 非法值 ⇒ **空字符串**（调用方据此跳过注入，零行为变更）。
 */
export function buildReplyEffortPrompt(level: unknown): string {
  const normalized = normalizeReplyEffort(level);
  if (normalized === 'auto') return '';
  return EFFORT_PROMPTS[normalized];
}

/**
 * 档位 → 思考预算（token）。`auto` ⇒ `undefined`（不设定预算）。
 *
 * 2026-10-23（`/effort` 第二步）：预算已由 `resolveThinkingForSession()` 接入本轮
 * `thinking` 配置，并经 Provider 下发（Messages API / Chat Completions / Gemini）。
 */
export function resolveEffortThinkingBudget(
  level: unknown
): number | undefined {
  const normalized = normalizeReplyEffort(level);
  if (normalized === 'auto') return undefined;
  return EFFORT_TO_BUDGET[normalized];
}

/** 思考配置（与 `ChatOptions.thinking` / `SendMessageOptions.thinking` 同构） */
export type ReplyThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' };

/**
 * 会话元数据 → 本轮思考配置（2026-10-23，`/effort` 第二步）。
 *
 * 规则：
 * - `supportsThinking === false`（模型 `capabilities` 无 `thinking`）⇒ **不注入**；
 * - 优先用显式 `metadata.thinkingBudget`（`/effort` 落库值），否则由 `effortLevel` 推导；
 * - `auto` / 非法 / 预算 ≤ 0 ⇒ **不注入**（与接线前逐字一致）。
 *
 * @param metadata 会话元数据（`{ effortLevel?, thinkingBudget? }`）
 * @param supportsThinking 该模型是否支持思考（DB capabilities 判定结果）
 */
export function resolveThinkingForSession(
  metadata: Record<string, unknown> | undefined,
  supportsThinking: boolean
): ReplyThinkingConfig | undefined {
  if (!supportsThinking) return undefined;

  const explicit = metadata?.['thinkingBudget'];
  const budget =
    typeof explicit === 'number' && explicit > 0
      ? explicit
      : resolveEffortThinkingBudget(metadata?.['effortLevel']);

  if (budget === undefined || budget <= 0) return undefined;
  return { type: 'enabled', budgetTokens: budget };
}
