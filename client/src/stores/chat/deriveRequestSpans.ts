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
 * deriveRequestSpans —— 请求（request）区间只读派生（P2-2，2026-09-23）
 *
 * 规格：`.trae/specs/request-boundary-events.md`（v0.2）。
 *
 * **配对键 = `request/start` 事件自身的 `seq`**（后端写入端把它作为 requestId 贯穿到该请求
 * 的**所有**完成侧写入点，见 `app/src/chat/services/requestBoundary.ts`）。
 * 不复用 `callSeq`（它归 `tool/result ↔ tool_call` 配对，且恒等于事件自身 seq）。
 *
 * **多条完成事件归并到同一区间**：一次请求可能产 0/1/2 条请求级 `metric/timing`
 * （**延迟条** `ttfb`/`ttft` + **用量条** `tokens`/`inputTokens`…，各自不同 seq）⇒ 本模块
 * 按 requestId 归并，逐字段取**首个真实值**，**绝不跨 requestId 混用**。
 *
 * **只画真实数据（缺就不写，绝不造值）**：
 * - 有 start 无完成（请求中断 / 进程重启 / start 落盘失败）⇒ `end`/`duration` **如实缺省**；
 * - 旧事件无 `requestId`、或完成事件的 requestId 无对应 start（陌生 requestId）⇒ **忽略**，
 *   不合入任何区间，也不凭空造一条只有完成事件的区间。
 *
 * **复杂度（P3-3）**：时间 `O(E + S log S)`（`E` = 事件数，`S` = 请求数；S ≤ E，排序为
 * 编号稳定性所需）；空间 `O(S)`。
 */

import type { LiriEvent } from "@/types";

/** 请求区间（一条 = 一次真实 LLM 请求） */
export interface RequestSpan {
  /** 请求标识（= `request/start` 事件的 seq） */
  requestId: number;
  /** 请求编号 `R#n`（按 `request/start` 的 seq 升序自增，1 起；与 turn 编号互不覆盖） */
  index: number;
  /** `request/start` 事件 seq（点击定位用） */
  startSeq: number;
  /** 请求发出时刻 */
  start: number;
  /** 完成事件 seq（最早一条完成事件；缺 ⇒ 缺省） */
  endSeq?: number;
  /** 完成时刻（最早一条完成事件的 time）；缺完成 ⇒ 缺省 */
  end?: number;
  /** 请求耗时 ms（优先事件自带 `duration`，否则 `end − start`）；两侧不足 ⇒ 缺省 */
  duration?: number;
  /** 总 tokens（用量条；缺失 ⇒ 缺省，不写 0） */
  tokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** 首块（字节）延迟 ms（延迟条） */
  ttfb?: number;
  /** 首个内容 token 延迟 ms（延迟条；纯 tool_call 响应缺省） */
  ttft?: number;
  /** 模型标识（取自 `request/start`） */
  model?: string;
  /** 请求来源（取自 `request/start`；缺省视为普通对话请求） */
  reason?: "chat" | "compaction";
  /** 所属回合（取自 `request/start`；请求发出时 turn 未分配则缺省） */
  turn?: number;
}

/** 仅接受有限数值；其他类型 / NaN / Infinity ⇒ undefined（视为缺失，不造值） */
function numOr(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** 首个非 undefined 的值（逐字段归并：不同完成事件可分别贡献不同字段） */
function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  for (const v of values) {
    if (v !== undefined) return v;
  }
  return undefined;
}

/**
 * 派生请求区间（按 `request/start` 出现顺序编号 `R#n`）。
 *
 * 入参顺序无关：编号与配对只依据事件自身的 `seq` / `requestId`。
 */
export function deriveRequestSpans(
  events: readonly LiriEvent[],
): RequestSpan[] {
  /** 请求开始：requestId(=seq) → 事件 */
  const starts = new Map<number, LiriEvent>();
  for (const e of events) {
    if (e.type !== "request/start") continue;
    if (!Number.isFinite(e.seq) || e.seq <= 0) continue;
    if (!starts.has(e.seq)) starts.set(e.seq, e);
  }
  if (starts.size === 0) return [];

  /** 区间骨架（按 seq 升序 ⇒ R#n 稳定） */
  const ordered = [...starts.values()].sort((a, b) => a.seq - b.seq);
  const spans = new Map<number, RequestSpan>();
  ordered.forEach((startEvent, i) => {
    const data = startEvent.data as {
      model?: unknown;
      reason?: unknown;
      turn?: unknown;
    };
    spans.set(startEvent.seq, {
      requestId: startEvent.seq,
      index: i + 1,
      startSeq: startEvent.seq,
      start: startEvent.time,
      model: typeof data.model === "string" ? data.model : undefined,
      reason:
        data.reason === "chat" || data.reason === "compaction"
          ? data.reason
          : undefined,
      turn: numOr(data.turn),
    });
  });

  // 完成事件归并（多条 → 同一 requestId 区间；不跨 requestId 混用）
  for (const e of events) {
    if (e.type !== "metric/timing") continue;
    const d = e.data as {
      requestId?: unknown;
      duration?: unknown;
      tokens?: unknown;
      inputTokens?: unknown;
      outputTokens?: unknown;
      cacheReadTokens?: unknown;
      cacheCreationTokens?: unknown;
      ttfb?: unknown;
      ttft?: unknown;
    };
    const requestId = numOr(d.requestId);
    if (requestId === undefined) continue; // 旧事件 / 无可配对键 ⇒ 忽略
    const span = spans.get(requestId);
    if (!span) continue; // 陌生 requestId（无对应 start）⇒ 忽略，不造区间

    // 完成时刻必须不早于请求起点（与既有 turn/tool 配对同一口径）；倒挂 ⇒ 不对齐为 end
    const endTime = e.time >= span.start ? e.time : undefined;
    if (
      endTime !== undefined &&
      (span.end === undefined || endTime < span.end)
    ) {
      span.end = endTime;
      span.endSeq = e.seq;
    }
    span.duration = firstDefined(span.duration, numOr(d.duration));
    span.tokens = firstDefined(span.tokens, numOr(d.tokens));
    span.inputTokens = firstDefined(span.inputTokens, numOr(d.inputTokens));
    span.outputTokens = firstDefined(span.outputTokens, numOr(d.outputTokens));
    span.cacheReadTokens = firstDefined(
      span.cacheReadTokens,
      numOr(d.cacheReadTokens),
    );
    span.cacheCreationTokens = firstDefined(
      span.cacheCreationTokens,
      numOr(d.cacheCreationTokens),
    );
    span.ttfb = firstDefined(span.ttfb, numOr(d.ttfb));
    span.ttft = firstDefined(span.ttft, numOr(d.ttft));
  }

  // 无自带 duration ⇒ 用真实墙钟差补（两侧齐全才算；不造 0）
  for (const span of spans.values()) {
    if (span.duration === undefined && span.end !== undefined) {
      const wall = span.end - span.start;
      if (Number.isFinite(wall) && wall >= 0) span.duration = wall;
    }
  }

  return ordered.map((startEvent) => spans.get(startEvent.seq)!);
}
