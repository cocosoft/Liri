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
 * deriveApiMetrics 单测（API 指标展示，2026-09-23）
 *
 * ## 夹具原则（CS04）
 * 事件为**结构合法的 LiriEvent**（seq/time/type/sessionId/data），时间基准固定 `T0`，
 * 不依赖 `Date.now()`；断言只锁**真实派生结果**，全部样本数为可手算的整数。
 *
 * ## 覆盖口径（与 Spec §5 对应）
 * 无数据 / 单样本 / 多样本分位数 / 缺 ttft / ttft-ttfb 独立 / token 分桶与缺失 /
 * 非请求级事件排除 / 脏值守卫。
 *
 * ⚠️ 生产者核对（2026-09-23 实测）：请求级事件由**两个**写入点产出且字段互不重叠 ——
 * 延迟类（`streamMessageFlow.ts:1533-1548`：`ttfb`/`ttft?`）与用量类
 * （`ChatManager.ts:3386-3394`：`tokens`/`inputTokens`/…）。故夹具按**两条事件**分别建模；
 * `requestCount` 相应为"请求级事件数"（一次 API 调用最多 2 条），非"API 调用次数"。
 */

import { describe, expect, it } from "vitest";
import { deriveApiMetrics } from "../stores/chat/deriveApiMetrics";
import type { LiriEvent } from "../types";

/** 固定基准时刻（避免 `Date.now()` 让断言漂移） */
const T0 = 1_700_000_000_000;

/** 构造 LiriEvent（时间按 seq 递增 1s，与既有轨迹用例同口径） */
function ev(
  seq: number,
  type: LiriEvent["type"],
  data: Record<string, unknown> = {},
): LiriEvent {
  return {
    seq,
    time: T0 + seq * 1000,
    type,
    sessionId: "sid-api-metrics",
    data,
  } as LiriEvent;
}

/** 全空结果（多处复用，避免逐字段重复断言） */
const EMPTY = {
  requestCount: 0,
  latencyEventCount: 0,
  missingTtftCount: 0,
  ttft: null,
  ttfb: null,
  tokens: null,
};

describe("deriveApiMetrics（请求指标聚合）", () => {
  it("1. 无事件 ⇒ 全 0 / 全 null（不造默认值）", () => {
    expect(deriveApiMetrics([])).toEqual(EMPTY);
  });

  it("2. 有事件但无 metric/timing ⇒ 不参与统计", () => {
    const events = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "user/message", { content: "hi" }),
      ev(3, "assistant/text", { content: "hello" }),
      ev(4, "turn/end", { turn: 1 }),
    ];
    expect(deriveApiMetrics(events)).toEqual(EMPTY);
  });

  it("3. 单样本（n=1）⇒ 不出分位数，但请求级事件仍如实计数", () => {
    const events = [
      ev(1, "metric/timing", { stage: "request", ttfb: 120, ttft: 200 }),
    ];
    expect(deriveApiMetrics(events)).toEqual({
      requestCount: 1,
      latencyEventCount: 1,
      missingTtftCount: 0,
      ttft: null, // n=1 ⇒ 不出分位数（不拿同一个数冒充 p50 与 p95）
      ttfb: null,
      tokens: null,
    });
  });

  it("4. n≥2 ⇒ p50/p95 为最近秩真实样本值（可手算）", () => {
    // ttft = 100/200/300/400；ttfb = 120/240/360/480
    const events = [
      ev(1, "metric/timing", { stage: "request", ttfb: 120, ttft: 100 }),
      ev(2, "metric/timing", { stage: "request", ttfb: 240, ttft: 200 }),
      ev(3, "metric/timing", { stage: "request", ttfb: 360, ttft: 300 }),
      ev(4, "metric/timing", { stage: "request", ttfb: 480, ttft: 400 }),
    ];
    const m = deriveApiMetrics(events);
    // nearest-rank：p50 ⇒ ⌈0.5×4⌉=2 ⇒ 第 2 个；p95 ⇒ ⌈0.95×4⌉=4 ⇒ 第 4 个
    expect(m.ttft).toEqual({ p50: 200, p95: 400, n: 4 });
    expect(m.ttfb).toEqual({ p50: 240, p95: 480, n: 4 });
    expect(m.requestCount).toBe(4);
    expect(m.latencyEventCount).toBe(4);
    expect(m.missingTtftCount).toBe(0);
  });

  it("5. 缺 ttft 的请求 ⇒ 计入 missingTtftCount 且不参与 ttft 分位数（仍参与 ttfb）", () => {
    const events = [
      ev(1, "metric/timing", { stage: "request", ttfb: 100, ttft: 300 }),
      ev(2, "metric/timing", { stage: "request", ttfb: 200, ttft: 500 }),
      // 纯 tool_call 响应：有 ttfb、无内容 chunk ⇒ 生产者不写 ttft
      ev(3, "metric/timing", { stage: "request", ttfb: 900 }),
    ];
    const m = deriveApiMetrics(events);
    expect(m.missingTtftCount).toBe(1);
    expect(m.ttft).toEqual({ p50: 300, p95: 500, n: 2 }); // 缺 ttft 那条不参与
    expect(m.ttfb).toEqual({ p50: 200, p95: 900, n: 3 }); // 它仍参与 ttfb
    expect(m.latencyEventCount).toBe(3);
    expect(m.requestCount).toBe(3);
  });

  it("6. ttft 与 ttfb 分别独立统计（标签不混淆）", () => {
    const events = [
      ev(1, "metric/timing", { stage: "request", ttfb: 10, ttft: 1000 }),
      ev(2, "metric/timing", { stage: "request", ttfb: 20, ttft: 2000 }),
    ];
    const m = deriveApiMetrics(events);
    expect(m.ttft).toEqual({ p50: 1000, p95: 2000, n: 2 });
    expect(m.ttfb).toEqual({ p50: 10, p95: 20, n: 2 });
    // 不把 ttfb 当 ttft 用：两组数值必须各自独立（互换即失败）
    expect(m.ttft?.p50).not.toBe(m.ttfb?.p50);
  });

  it("7. token 分桶各自累加（含缓存读/写命中）", () => {
    const events = [
      ev(1, "metric/timing", {
        stage: "request",
        tokens: 100,
        inputTokens: 60,
        outputTokens: 40,
        cacheReadTokens: 30,
        cacheCreationTokens: 10,
      }),
      ev(2, "metric/timing", {
        stage: "request",
        tokens: 50,
        inputTokens: 20,
        outputTokens: 30,
      }),
    ];
    const m = deriveApiMetrics(events);
    expect(m.tokens).toEqual({
      input: 80,
      output: 70,
      total: 150,
      cacheRead: 30,
      cacheCreation: 10,
    });
    // 用量类事件**不含延迟字段** ⇒ 不应被算作"延迟样本"或"缺 ttft"
    expect(m.latencyEventCount).toBe(0);
    expect(m.missingTtftCount).toBe(0);
    expect(m.ttft).toBeNull();
    expect(m.ttfb).toBeNull();
    expect(m.requestCount).toBe(2);
  });

  it("8. 只给部分 token 字段 ⇒ 缺失桶按 0 累加，但 tokens !== null", () => {
    const events = [
      ev(1, "metric/timing", { stage: "request", outputTokens: 30 }),
      ev(2, "metric/timing", { stage: "request", inputTokens: 12 }),
    ];
    expect(deriveApiMetrics(events).tokens).toEqual({
      input: 12,
      output: 30,
      total: 0, // 两条都没写 `tokens` ⇒ 桶按 0 累加（整体仍非 null）
      cacheRead: 0,
      cacheCreation: 0,
    });
  });

  it("9. 一条 token 字段都没有（只有延迟类事件）⇒ tokens === null", () => {
    const events = [
      ev(1, "metric/timing", { stage: "request", ttfb: 100, ttft: 200 }),
    ];
    expect(deriveApiMetrics(events).tokens).toBeNull();
  });

  it("10. 回合级 / 缺 stage / 非 metric 事件都不计入请求级", () => {
    const events = [
      ev(1, "metric/timing", { stage: "assistant", duration: 2500 }),
      ev(2, "metric/timing", { duration: 1200 }), // 缺 stage
      ev(3, "assistant/text", { content: "x", ttfb: 10, ttft: 20 }), // 非 metric 事件带同名字段
      ev(4, "system/info", { message: "m" }),
    ];
    expect(deriveApiMetrics(events)).toEqual(EMPTY);
  });

  it("11. 脏值（字符串 / NaN）视为缺失，不写进统计", () => {
    const events = [
      ev(1, "metric/timing", {
        stage: "request",
        ttfb: "120",
        ttft: Number.NaN,
      }),
      ev(2, "metric/timing", { stage: "request", ttfb: 120, ttft: 200 }),
      ev(3, "metric/timing", { stage: "request", ttfb: 240, ttft: 300 }),
    ];
    const m = deriveApiMetrics(events);
    expect(m.requestCount).toBe(3); // 仍是请求级事件
    expect(m.latencyEventCount).toBe(2); // 首条 ttfb 非数值 ⇒ 不算延迟样本
    expect(m.missingTtftCount).toBe(0);
    expect(m.ttfb).toEqual({ p50: 120, p95: 240, n: 2 });
    expect(m.ttft).toEqual({ p50: 200, p95: 300, n: 2 });
  });
});
