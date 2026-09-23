// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 轨迹事件过滤（P1-5 节流配套）—— 纯函数单测
 *
 * 本文件覆盖的过滤逻辑此前**零测试**（内联在 `ChatInspector` 的 memo 里）。
 * 锁定的语义（与抽取前逐条一致）：
 * - 各维度"与"关系，空数组/undefined = 不过滤；
 * - keyword 去空白 + 大小写不敏感 + 命中任一候选字段即保留；
 * - 来源维度由 `categorizeEvent` 派生（`categoryToSource`），未知分类回落 `system`。
 */
import { describe, it, expect } from "vitest";
import {
  categoryToSource,
  filterTrajectoryEvents,
} from "../filterTrajectoryEvents";
import type { TrajectoryFilterState } from "../trajectoryStore";
import type { LiriEvent } from "@/types";

function ev(
  seq: number,
  time: number,
  type: LiriEvent["type"],
  data: Record<string, unknown> = {},
): LiriEvent {
  return { type, seq, time, sessionId: "s1", data } as unknown as LiriEvent;
}

function baseFilter(
  patch: Partial<TrajectoryFilterState> = {},
): TrajectoryFilterState {
  return { categories: [], types: [], sources: [], keyword: "", ...patch };
}

/** 5 条覆盖不同 category/source 的事件 */
function sample(): LiriEvent[] {
  return [
    ev(1, 1000, "user/message", { content: "hello world" }),
    ev(2, 2000, "assistant/tool_call", { toolCallId: "c1", name: "grep" }),
    ev(3, 3000, "tool/result", { toolCallId: "c1", result: "OK" }),
    ev(4, 4000, "system/info", { module: "m", message: "boot" }),
    ev(5, 5000, "session/start", { startedAt: 1 }),
  ];
}

describe("filterTrajectoryEvents", () => {
  it("空过滤器 ⇒ 原样返回（同一引用，零开销）", () => {
    const events = sample();
    expect(filterTrajectoryEvents(events, baseFilter())).toBe(events);
  });

  it("categories：只保留命中分类", () => {
    const out = filterTrajectoryEvents(
      sample(),
      baseFilter({ categories: ["tool"] }),
    );
    expect(out.map((e) => e.seq)).toEqual([2, 3]);
  });

  it("types：按事件类型精确过滤", () => {
    const out = filterTrajectoryEvents(
      sample(),
      baseFilter({ types: ["user/message", "system/info"] }),
    );
    expect(out.map((e) => e.seq)).toEqual([1, 4]);
  });

  it("sources：由 categorizeEvent 派生（llm / tool / system）", () => {
    expect(
      filterTrajectoryEvents(sample(), baseFilter({ sources: ["llm"] })).map(
        (e) => e.seq,
      ),
    ).toEqual([1]);
    expect(
      filterTrajectoryEvents(sample(), baseFilter({ sources: ["tool"] })).map(
        (e) => e.seq,
      ),
    ).toEqual([2, 3]);
    // context/system/lifecycle 均归入 system（seq 4=system/info，5=session/start）
    expect(
      filterTrajectoryEvents(sample(), baseFilter({ sources: ["system"] })).map(
        (e) => e.seq,
      ),
    ).toEqual([4, 5]);
  });

  it("seq 区间：minSeq / maxSeq 闭区间", () => {
    expect(
      filterTrajectoryEvents(sample(), baseFilter({ minSeq: 3 })).map(
        (e) => e.seq,
      ),
    ).toEqual([3, 4, 5]);
    expect(
      filterTrajectoryEvents(sample(), baseFilter({ maxSeq: 2 })).map(
        (e) => e.seq,
      ),
    ).toEqual([1, 2]);
    expect(
      filterTrajectoryEvents(
        sample(),
        baseFilter({ minSeq: 2, maxSeq: 4 }),
      ).map((e) => e.seq),
    ).toEqual([2, 3, 4]);
  });

  it("时间区间：fromTime / toTime 闭区间（毫秒）", () => {
    expect(
      filterTrajectoryEvents(sample(), baseFilter({ fromTime: 3000 })).map(
        (e) => e.seq,
      ),
    ).toEqual([3, 4, 5]);
    expect(
      filterTrajectoryEvents(sample(), baseFilter({ toTime: 3000 })).map(
        (e) => e.seq,
      ),
    ).toEqual([1, 2, 3]);
  });

  it("keyword：去空白 + 大小写不敏感 + 命中任一候选字段", () => {
    // content
    expect(
      filterTrajectoryEvents(
        sample(),
        baseFilter({ keyword: "  HELLO  " }),
      ).map((e) => e.seq),
    ).toEqual([1]);
    // result（"OK" 小写命中）
    expect(
      filterTrajectoryEvents(sample(), baseFilter({ keyword: "ok" })).map(
        (e) => e.seq,
      ),
    ).toEqual([3]);
    // name
    expect(
      filterTrajectoryEvents(sample(), baseFilter({ keyword: "grep" })).map(
        (e) => e.seq,
      ),
    ).toEqual([2]);
    // toolCallId
    expect(
      filterTrajectoryEvents(sample(), baseFilter({ keyword: "c1" })).map(
        (e) => e.seq,
      ),
    ).toEqual([2, 3]);
    // message
    expect(
      filterTrajectoryEvents(sample(), baseFilter({ keyword: "boot" })).map(
        (e) => e.seq,
      ),
    ).toEqual([4]);
  });

  it("keyword 无命中 ⇒ 空结果；纯空白 ⇒ 视为不过滤", () => {
    expect(
      filterTrajectoryEvents(sample(), baseFilter({ keyword: "zzz" })),
    ).toEqual([]);
    const events = sample();
    expect(filterTrajectoryEvents(events, baseFilter({ keyword: "   " }))).toBe(
      events,
    );
  });

  it("多维度为『与』关系", () => {
    const out = filterTrajectoryEvents(
      sample(),
      baseFilter({ sources: ["tool"], keyword: "ok" }),
    );
    expect(out.map((e) => e.seq)).toEqual([3]);
  });

  it("categoryToSource：已知分类映射，未知分类回落 system", () => {
    expect(categoryToSource("conversation")).toBe("llm");
    expect(categoryToSource("tool")).toBe("tool");
    expect(categoryToSource("channel")).toBe("channel");
    expect(categoryToSource("lifecycle")).toBe("system");
    expect(categoryToSource("no-such-category")).toBe("system");
  });
});
