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
 * deriveApiMetrics —— 「请求指标」纯聚合（轨迹检查器分区用）
 *
 * 立项：`.trae/specs/api-metrics-surface.md`（2026-09-23，D2/D3/D4 已裁决）。
 * 数据源**唯一**：会话事件流里的 `metric/timing` 事件（§1.6 事件溯源，数出同源）。
 *
 * ## 口径（沿用既有 P3-4 约定）
 * - **只累加事件自带字段**，**不跨事件拼接**（如"tokens ÷ duration"不是任何一次真实测量）；
 * - 缺项 ⇒ `null` / 不产出，**不造 0 伪装**（CS03/CS04）；
 * - 分位数只用**真实测量值**：`n < 2` 时**不产出**（不拿同一个数同时充当 p50 与 p95）。
 *
 * ## 生产者核对（2026-09-23 实测 grep，非推测）
 * 请求级（`stage === 'request'`）由**两个**写入点产出，字段**互不重叠**：
 * - 延迟类：`app/src/chat/orchestrator/streamMessageFlow.ts:1533-1548`
 *   ⇒ `{ stage: 'request', ttfb, ttft? }`（`ttft` 仅在"有内容 chunk"时写入 ⇒ 纯 tool_call 响应缺省）
 * - 用量类：`app/src/chat/ChatManager.ts:3386-3394`（`buildRequestTimingData`）
 *   ⇒ `{ stage: 'request', tokens, inputTokens, outputTokens, cacheReadTokens?, cacheCreationTokens? }`
 * - 回合级：`app/src/chat/ChatManager.ts:1619-1627` ⇒ `{ stage: 'assistant', duration }`
 *   —— **不属请求级**，不计入本模块任何指标（其聚合已由时间线 header 承担）。
 *
 * ⇒ **一次成功的 API 调用最多产生 2 条请求级事件**（延迟一条 + 用量一条），事件之间**无
 * 请求 ID 可配对**（不做推测性归并）⇒ `requestCount` 的语义是"**请求级事件数**"，
 * **不是**"API 调用次数"（UI 文案据此如实标注，见 `ChatInspector` 的「请求指标」分区）。
 *
 * ## 复杂度（P3-3）
 * 时间 `O(E log E)`：`E` = 事件数；主因是分位数需对样本排序（`O(k log k)`，`k ≤ E`）。
 * 空间 `O(k)`：仅物化两个样本数组（`k` = 请求级事件数）。
 * **取舍**：中位数 / p95 无法在"不排序且不物化"下精确求得，近似算法会引入误差 ——
 * 与"只报真实测量值"的口径冲突，故选择**精确**的最近秩（nearest-rank）实现。
 */

import type { LiriEvent } from "../../types";

/** 分位数结果（最近秩算法；`n` = 样本数） */
export interface ApiMetricsPercentiles {
  p50: number;
  p95: number;
  n: number;
}

/** token 分桶（各桶**只能**来自事件自带字段；缺失项按 0 累加，整体是否产出另判） */
export interface ApiMetricsTokens {
  input: number;
  output: number;
  total: number;
  cacheRead: number;
  cacheCreation: number;
}

export interface ApiMetricsSummary {
  /**
   * 请求级（`stage === 'request'`）`metric/timing` 事件数。
   *
   * ⚠️ 语义按生产者如实定义：延迟类与用量类**分属两条事件** ⇒ 一次 API 调用最多计 2。
   */
  requestCount: number;
  /**
   * **带延迟测量**（`ttfb` 存在）的请求级事件数 —— 即 `ttft`/`ttfb` 的样本来源。
   *
   * 用途：UI 据此区分"**无延迟数据**"（0 ⇒ 不渲染延迟项）与"**有延迟数据但样本不足**"
   * （`> 0` 且分位数为 `null` ⇒ 显示"样本不足"，而不是谎报一个数值）。
   */
  latencyEventCount: number;
  /**
   * 延迟类事件中**缺 `ttft`** 的条数（= 纯 tool_call 响应：无内容 chunk ⇒ 生产者不写 `ttft`）。
   *
   * 口径为何不以"全部请求级事件"为分母：用量类事件**本就不含延迟字段**，
   * 若一并计入会把"从未测量过 TTFT"表达成"TTFT 缺失"，语义失真。
   */
  missingTtftCount: number;
  /** 首个内容 token 延迟分位数（样本 `n < 2` ⇒ `null`，不出分位数） */
  ttft: ApiMetricsPercentiles | null;
  /** 首块（字节）延迟分位数（样本 `n < 2` ⇒ `null`，不出分位数） */
  ttfb: ApiMetricsPercentiles | null;
  /** token 分桶（**一条都无** token 字段 ⇒ `null`，不造全 0 桶） */
  tokens: ApiMetricsTokens | null;
}

/** 有限数值守卫（非 number / NaN / Infinity ⇒ `undefined`，视为缺失） */
function numberOr(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * 最近秩（nearest-rank）取分位数：`rank = ⌈p/100 × n⌉`，取升序样本第 `rank` 个（1-based）。
 *
 * 选它而非插值法：结果**必然是某个真实样本值**，不含任何插值出来的"中间数"。
 */
function nearestRank(sortedAsc: number[], p: number): number {
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1));
  return sortedAsc[idx];
}

/** 样本 ⇒ 分位数；`n < 2` ⇒ `null`（单样本不足以谈分位数） */
function percentilesOf(samples: number[]): ApiMetricsPercentiles | null {
  if (samples.length < 2) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: nearestRank(sorted, 50),
    p95: nearestRank(sorted, 95),
    n: sorted.length,
  };
}

/**
 * 聚合请求级 `metric/timing` 指标。
 *
 * @param events 已被 `filterTrajectoryEvents` 过滤的事件（与轨迹列表同源，口径一致）
 */
export function deriveApiMetrics(events: LiriEvent[]): ApiMetricsSummary {
  let requestCount = 0;
  let latencyEventCount = 0;
  let missingTtftCount = 0;
  const ttftSamples: number[] = [];
  const ttfbSamples: number[] = [];

  let sawTokenField = false;
  let input = 0;
  let output = 0;
  let total = 0;
  let cacheRead = 0;
  let cacheCreation = 0;

  for (const e of events) {
    if (e.type !== "metric/timing") continue;
    const d = e.data as {
      stage?: unknown;
      ttfb?: unknown;
      ttft?: unknown;
      tokens?: unknown;
      inputTokens?: unknown;
      outputTokens?: unknown;
      cacheReadTokens?: unknown;
      cacheCreationTokens?: unknown;
    };
    // 只认**请求级**；`assistant`（回合级 duration）与缺 `stage` 的事件都不计入
    if (d.stage !== "request") continue;
    requestCount += 1;

    const ttfb = numberOr(d.ttfb);
    const ttft = numberOr(d.ttft);
    if (ttfb !== undefined) {
      latencyEventCount += 1;
      ttfbSamples.push(ttfb);
      // 有延迟测量却无 ttft ⇒ 纯 tool_call 响应（生产者契约：无内容 chunk 不写 ttft）
      if (ttft === undefined) missingTtftCount += 1;
    }
    if (ttft !== undefined) ttftSamples.push(ttft);

    // token 分桶：任一桶字段存在 ⇒ 产出桶（缺失桶按 0 累加；一条都没有 ⇒ 整体 null）
    const tInput = numberOr(d.inputTokens);
    const tOutput = numberOr(d.outputTokens);
    const tTotal = numberOr(d.tokens);
    const tCacheRead = numberOr(d.cacheReadTokens);
    const tCacheCreation = numberOr(d.cacheCreationTokens);
    if (
      tInput !== undefined ||
      tOutput !== undefined ||
      tTotal !== undefined ||
      tCacheRead !== undefined ||
      tCacheCreation !== undefined
    ) {
      sawTokenField = true;
      input += tInput ?? 0;
      output += tOutput ?? 0;
      total += tTotal ?? 0;
      cacheRead += tCacheRead ?? 0;
      cacheCreation += tCacheCreation ?? 0;
    }
  }

  return {
    requestCount,
    latencyEventCount,
    missingTtftCount,
    ttft: percentilesOf(ttftSamples),
    ttfb: percentilesOf(ttfbSamples),
    tokens: sawTokenField
      ? { input, output, total, cacheRead, cacheCreation }
      : null,
  };
}
