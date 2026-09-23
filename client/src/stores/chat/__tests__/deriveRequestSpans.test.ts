// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `deriveRequestSpans` 单测（P2-2，2026-09-23）
 *
 * 锁定四条口径：
 * 1. **配对键 = `request/start` 的 seq**（= requestId）—— 不看 `callSeq`（它归工具配对）；
 * 2. **多完成事件归并到同一区间**（延迟条 `ttfb`/`ttft` + 用量条 `tokens`…，逐字段取首个真实值），
 *    且**绝不跨 requestId 混用**；
 * 3. **缺完成 ⇒ `end`/`duration` 如实缺省**（不造 0、不拿估算顶替）；
 * 4. **陌生 requestId / 无 requestId 的旧事件 ⇒ 忽略**（不造"只有完成事件的区间"）。
 */

import { describe, it, expect } from "vitest";
import { deriveRequestSpans } from "../deriveRequestSpans";
import type { LiriEvent } from "@/types";

const T0 = 1_700_000_000_000;

function ev(
  seq: number,
  type: LiriEvent["type"],
  data: Record<string, unknown> = {},
  time = T0 + seq * 1000,
): LiriEvent {
  return { seq, time, type, sessionId: "s1", data } as unknown as LiriEvent;
}

describe("deriveRequestSpans", () => {
  it("空输入 / 无 request/start ⇒ 空数组（不硬凑区间）", () => {
    expect(deriveRequestSpans([])).toEqual([]);
    expect(
      deriveRequestSpans([
        ev(1, "turn/start", { turn: 1 }),
        // 旧事件：请求级 metric/timing 但**无** requestId ⇒ 无可配对键
        ev(2, "metric/timing", { stage: "request", tokens: 10 }),
        ev(3, "turn/end", { turn: 1 }),
      ]),
    ).toEqual([]);
  });

  it("配对成功：延迟条 + 用量条归并为同一区间（逐字段取真实值）", () => {
    const spans = deriveRequestSpans([
      ev(3, "request/start", { turn: 1, model: "m-1", reason: "chat" }),
      // 延迟条（完成时刻 T0+5000；无 tokens）
      ev(
        4,
        "metric/timing",
        { stage: "request", ttfb: 300, ttft: 420, requestId: 3 },
        T0 + 5000,
      ),
      // 用量条（完成时刻稍晚；无 ttfb）
      ev(
        5,
        "metric/timing",
        {
          stage: "request",
          tokens: 1200,
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 64,
          requestId: 3,
        },
        T0 + 5200,
      ),
    ]);

    expect(spans).toHaveLength(1);
    const r = spans[0];
    expect(r.requestId).toBe(3);
    expect(r.index).toBe(1);
    expect(r.startSeq).toBe(3);
    expect(r.start).toBe(T0 + 3000);
    // end 取**最早**完成事件（延迟条）
    expect(r.end).toBe(T0 + 5000);
    expect(r.endSeq).toBe(4);
    // duration 无自带值 ⇒ 真实墙钟差（2000ms）
    expect(r.duration).toBe(2000);
    expect(r.ttfb).toBe(300);
    expect(r.ttft).toBe(420);
    expect(r.tokens).toBe(1200);
    expect(r.inputTokens).toBe(1000);
    expect(r.outputTokens).toBe(200);
    expect(r.cacheReadTokens).toBe(64);
    expect(r.model).toBe("m-1");
    expect(r.turn).toBe(1);
    expect(r.reason).toBe("chat");
    // 未出现的字段**缺省不造值**（`undefined`，不是 0）
    expect(r.cacheCreationTokens).toBeUndefined();
  });

  it("缺完成事件（中断 / 进程重启）⇒ end 与 duration 如实缺省", () => {
    const spans = deriveRequestSpans([
      ev(7, "request/start", { model: "m-1", reason: "chat" }),
      ev(8, "user/message", { content: "hi" }),
    ]);
    expect(spans).toHaveLength(1);
    expect(spans[0].end).toBeUndefined();
    expect(spans[0].endSeq).toBeUndefined();
    expect(spans[0].duration).toBeUndefined();
    expect(spans[0].tokens).toBeUndefined();
  });

  it("不跨 requestId 混用：两个请求各自归并，字段互不串味", () => {
    const spans = deriveRequestSpans([
      ev(1, "request/start", { model: "m-1" }),
      ev(
        2,
        "metric/timing",
        { stage: "request", tokens: 100, requestId: 1 },
        T0 + 2500,
      ),
      ev(5, "request/start", { model: "m-2" }),
      ev(
        6,
        "metric/timing",
        { stage: "request", tokens: 999, requestId: 5 },
        T0 + 7000,
      ),
    ]);

    expect(spans.map((r) => [r.index, r.requestId, r.tokens, r.model])).toEqual(
      [
        [1, 1, 100, "m-1"],
        [2, 5, 999, "m-2"],
      ],
    );
  });

  it("陌生 requestId（无对应 request/start）⇒ 忽略，不造区间", () => {
    const spans = deriveRequestSpans([
      ev(1, "request/start", { model: "m-1" }),
      ev(
        2,
        "metric/timing",
        { stage: "request", requestId: 999, tokens: 42 },
        T0 + 3000,
      ),
    ]);
    expect(spans).toHaveLength(1);
    expect(spans[0].tokens).toBeUndefined();
  });

  it("编号按 request/start 的 seq 升序自增（与数组顺序无关）", () => {
    const spans = deriveRequestSpans([
      ev(
        9,
        "metric/timing",
        { stage: "request", requestId: 8, tokens: 8 },
        T0 + 9000,
      ),
      ev(8, "request/start", { model: "late" }),
      ev(
        2,
        "metric/timing",
        { stage: "request", requestId: 1, tokens: 1 },
        T0 + 3000,
      ),
      ev(1, "request/start", { model: "early" }),
    ]);
    expect(spans.map((r) => [r.index, r.requestId, r.model])).toEqual([
      [1, 1, "early"],
      [2, 8, "late"],
    ]);
  });

  it("compaction 请求：带 reason 标记与事件自带 duration（真实墙钟优先于 time 差）", () => {
    const spans = deriveRequestSpans([
      ev(4, "request/start", { model: "m-1", reason: "compaction" }),
      // 用量条缺失（provider 未返回 usage）⇒ 宿主只写 duration
      ev(
        5,
        "metric/timing",
        { stage: "request", duration: 1800, requestId: 4 },
        T0 + 5200,
      ),
    ]);
    expect(spans).toHaveLength(1);
    expect(spans[0].reason).toBe("compaction");
    expect(spans[0].duration).toBe(1800); // 事件自带值优先
    expect(spans[0].end).toBe(T0 + 5200);
  });

  it("倒挂完成事件（time < start）不设为 end（不产出负时长），但字段仍按 requestId 归并", () => {
    const spans = deriveRequestSpans([
      ev(6, "request/start", { model: "m-1" }, T0 + 10_000),
      ev(
        7,
        "metric/timing",
        { stage: "request", tokens: 5, requestId: 6 },
        T0 + 9000,
      ),
    ]);
    expect(spans).toHaveLength(1);
    expect(spans[0].tokens).toBe(5);
    expect(spans[0].end).toBeUndefined();
    expect(spans[0].duration).toBeUndefined();
  });

  it("非法字段（NaN / 非数值）视为缺失，不写进区间", () => {
    const spans = deriveRequestSpans([
      ev(1, "request/start", { model: 123, reason: "unknown", turn: "3" }),
      ev(
        2,
        "metric/timing",
        { stage: "request", requestId: "1", tokens: Number.NaN },
        T0 + 2000,
      ),
    ]);
    expect(spans).toHaveLength(1);
    // 载荷字段类型不符 ⇒ 缺省（不 coerce）
    expect(spans[0].model).toBeUndefined();
    expect(spans[0].reason).toBeUndefined();
    expect(spans[0].turn).toBeUndefined();
    expect(spans[0].tokens).toBeUndefined();
    // requestId 为字符串 ⇒ 无可配对键 ⇒ 该完成事件被忽略
    expect(spans[0].end).toBeUndefined();
  });
});
