// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * N-3（2026-11-06 真机）：PDCA 入口判定的**终态收敛**回归锁。
 *
 * 真机：`PLAN_PARSE_FAILED` 之后浮动栏永久显示「PDCA 编排进行中」——
 * 原 `visible` 只判"有没有最新事件"，终态（complete/fail）同样算命中。
 * 现口径：最新事件是终态 ⇒ 不再算"进行中"。
 *
 * 批次 14（P2-A，2026-11-24）：判据拆成 `active`（进行中）与 `available`（有 PDCA 可看，
 * 含终态）。终态后徽标收起，但抽屉（唯一进度详情来源）仍须可达。
 */
import { describe, expect, it } from "vitest";
import { resolvePdcaEntry, isTerminalPdcaEvent } from "../PdcaActivityStrip";
import type { PdcaLiveEventPayload } from "@/stores/orchestrationStore";

const SID = "session-n3";

function ev(
  type: string,
  extra?: Partial<PdcaLiveEventPayload> & { time?: number },
): PdcaLiveEventPayload {
  return {
    schemaVersion: 1,
    type,
    time: extra?.time ?? 1,
    taskId: "task-n3",
    sessionId: SID,
    data: {},
    ...extra,
  };
}

describe("resolvePdcaEntry — PDCA 入口/进行中判定（N-3）", () => {
  it("进行中的事件 ⇒ active/available 均 true 且带 taskId", () => {
    const started = ev("pdca:auto_launched", { time: 10 });
    expect(resolvePdcaEntry([started], {}, SID)).toEqual({
      active: true,
      available: true,
      taskId: "task-n3",
    });
    const phase = ev("pdca:stage:phase", { time: 20 });
    expect(resolvePdcaEntry([started, phase], {}, SID)).toEqual({
      active: true,
      available: true,
      taskId: "task-n3",
    });
  });

  it("最新是终态（complete / fail）⇒ active=false 但 available=true（抽屉仍可达）", () => {
    const started = ev("pdca:auto_launched", { time: 10 });
    expect(
      resolvePdcaEntry(
        [started, ev("pdca:stage:complete", { time: 30 })],
        {},
        SID,
      ),
    ).toEqual({ active: false, available: true, taskId: "task-n3" });
    expect(
      resolvePdcaEntry([started, ev("pdca:stage:fail", { time: 31 })], {}, SID)
        .active,
    ).toBe(false);
    // 终态后又有新一轮开始 ⇒ 重新算进行中
    expect(
      resolvePdcaEntry(
        [
          started,
          ev("pdca:stage:fail", { time: 31 }),
          ev("pdca:stage:start", { time: 40 }),
        ],
        {},
        SID,
      ).active,
    ).toBe(true);
  });

  it("只认当前会话；无会话 / 无事件 ⇒ 双 false", () => {
    expect(
      resolvePdcaEntry(
        [ev("pdca:auto_launched", { sessionId: "other" })],
        {},
        SID,
      ),
    ).toEqual({ active: false, available: false });
    expect(resolvePdcaEntry([], {}, undefined)).toEqual({
      active: false,
      available: false,
    });
  });

  it("P2-D：无实时事件但消息里有持久化卡片 ⇒ available=true、active=false", () => {
    expect(resolvePdcaEntry([], {}, SID, true)).toEqual({
      active: false,
      available: true,
    });
    // 无卡片则不可看
    expect(resolvePdcaEntry([], {}, SID, false)).toEqual({
      active: false,
      available: false,
    });
  });

  it("终态类型判定（镜像后端 PdcaLiveEvents）", () => {
    expect(isTerminalPdcaEvent(ev("pdca:stage:complete"))).toBe(true);
    expect(isTerminalPdcaEvent(ev("pdca:stage:fail"))).toBe(true);
    expect(isTerminalPdcaEvent(ev("pdca:stage:phase"))).toBe(false);
    expect(isTerminalPdcaEvent(ev("pdca:auto_launched"))).toBe(false);
  });
});
