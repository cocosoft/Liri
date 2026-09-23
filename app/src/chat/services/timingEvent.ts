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

/**
 * timingEvent.ts —— `metric/timing` 事件载荷构造（**纯函数**）
 *
 * TR-14 接线 + TR-12-A 用量分桶（2026-09-22）。决策见
 * `dev_docs/20260922/trajectory-benchmark/TR-12-TR-14-决策记录.md`。
 *
 * 设计要点（都是"只记真实数据、缺就不写"）：
 * - **请求级用量**（`stage:'request'`）：数据来自 provider 返回的**原始 usage**；缓存分桶复用
 *   `UsageExtractor.extractCacheTokens`（唯一实现）。**总 tokens 为 0 时不产事件**（对齐既有
 *   "0/0 跳过"约定）；缓存字段**只有 >0 才写**（避免把"该 provider 不返回缓存字段"表达成
 *   "缓存命中 0"）。
 * - **回合级耗时**（`stage:'assistant'`）：真实墙钟 = `createdAt`(完成) − `startedAt`(流式开始)，
 *   与 `Message.startedAt` 的既有语义一致（`chat/types/message.ts:426`："用于导出显示开始时间与耗时"）。
 *   `startedAt` 缺失 ⇒ **不产事件**（不用 `createdAt` 自身兜底成 0，那是伪造）。
 * - **不写 `ttft`**：现有 `ttfbMs` 在 provider 层、未挂到消息上；**取不到就不写**，不造近似值。
 */

import { extractCacheTokens } from '@modules/ai/tokenizer/UsageExtractor';

/** `metric/timing` 事件载荷（与 `LiriEventMap['metric/timing']` 对应） */
export interface TimingEventData {
  stage?: string;
  duration?: number;
  tokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/**
 * 请求级用量分桶。无可记 tokens（缺失 / 全 0）⇒ `null`。
 *
 * 入参按 `Record<string, unknown>` 收窄：provider 的原始 usage **可能含嵌套对象**
 *（如 `prompt_tokens_details`），这正是 `extractCacheTokens` 的既有入参形态。
 * 数值一律经 `numberOr` 守卫 —— 非 number / 非有限值视为**缺失**（宁可少记，
 * 不把脏值写进事件；注意这不改变 `recordChatResponseUsage` 的用量记账口径）。
 */
export function buildRequestTimingData(
  usage: Record<string, unknown> | null | undefined
): TimingEventData | null {
  if (!usage) return null;

  const inputTokens =
    numberOr(usage.prompt_tokens) ?? numberOr(usage.inputTokens) ?? 0;
  const outputTokens =
    numberOr(usage.completion_tokens) ?? numberOr(usage.outputTokens) ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return null;

  const cache = extractCacheTokens(usage);
  const data: TimingEventData = {
    stage: 'request',
    tokens: inputTokens + outputTokens,
    inputTokens,
    outputTokens,
  };
  if (cache.cacheReadTokens > 0) data.cacheReadTokens = cache.cacheReadTokens;
  if (cache.cacheCreationTokens > 0) {
    data.cacheCreationTokens = cache.cacheCreationTokens;
  }
  return data;
}

/** 仅接受有限数值；其他类型/NaN/Infinity ⇒ undefined（视为缺失） */
function numberOr(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * 回合级耗时（真实墙钟：流式开始 → 完成）。
 * 仅对 assistant 消息、且起止时刻**都有效**时产出；否则 `null`（不伪造）。
 */
export function buildAssistantTimingData(message: {
  role?: string;
  startedAt?: Date | number | string | null;
  createdAt?: Date | number | string | null;
}): TimingEventData | null {
  if (message.role !== 'assistant') return null;

  const start = toMillis(message.startedAt);
  const end = toMillis(message.createdAt);
  if (start === null || end === null) return null;

  const duration = end - start;
  if (!Number.isFinite(duration) || duration < 0) return null;

  return { stage: 'assistant', duration };
}

/** 归一化为毫秒时间戳；无法解析 ⇒ null（不用 0 兜底，避免伪造"0ms"） */
function toMillis(
  value: Date | number | string | null | undefined
): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
