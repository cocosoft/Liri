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
 * 轨迹模块快照测试（P2-4 剩余子项，2026-09-23）
 *
 * 覆盖两类"结构回归"：
 * ① **派生结果**：`deriveTrajectoryLayout`（Turn/Step/Cell 分组、孤立事件、退化计数）与
 *    `deriveTrajectoryTimeline`（时间域、turn/工具跨度、模型耗时区间、吞吐、标记数）。
 * ② **组件渲染**：`TrajectoryRow`（行标签 / 预览 / 选中态）与 `TrajectoryDetail`
 *    （头部、字段分区块、JSON 展示）。
 *
 * **与既有断言的互补**：既有用例断言的是**离散字段**（`expect(t.turn).toBe(1)` 等），
 * 快照锁定的是**整体形状** —— 新增/丢失字段、层级变化、组件 DOM 结构调整都会立刻可见，
 * 这正是"字段断言"覆盖不到的盲区（对标 P2-4「无快照」）。
 *
 * **确定性三原则**（否则快照会随环境漂移，变成"改了也绿"的假门禁）：
 * 1. **时间全部固定**（基准 `T0`，按 seq 递增），不依赖 `Date.now()`；
 * 2. **时间文案归一化** —— `toLocaleTimeString`/`toLocaleString` 结果**随运行时区变化**
 *    （Windows 本地与 Linux CI 可能不同）⇒ 快照前把日期/时刻替换为 `DATE`/`TIME` 占位，
 *    **只锁结构不锁时区**（保留完整时区断言属单测范畴，不应塞进快照）；
 * 3. **中文文案来自 setup.ts 的 `createTestT`（读真实 `zh.ts` 字典）**，缺键会直接抛错 ⇒
 *    快照里出现的是真实文案，而不是裸 key。
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  deriveTrajectoryLayout,
  flattenLayout,
} from "../stores/chat/deriveTrajectoryLayout";
import { deriveTrajectoryTimeline } from "../stores/chat/deriveTrajectoryTimeline";
import { TrajectoryRow } from "../components/Trajectory/TrajectoryRow";
import { TrajectoryDetail } from "../components/Trajectory/TrajectoryDetail";
import type { LiriEvent } from "../types";

/** 固定基准时刻（避免 `Date.now()` 让快照每次都变） */
const T0 = 1_700_000_000_000;

function ev(
  seq: number,
  type: LiriEvent["type"],
  data: Record<string, unknown> = {},
  time = T0 + seq * 1000,
): LiriEvent {
  return { seq, time, type, sessionId: "sid-snapshot", data } as LiriEvent;
}

/**
 * 场景：一个完整 turn（含工具调用 + 模型耗时/吞吐事件）+ 一条 turn 外的孤立事件。
 *
 * 刻意让 `metric/timing` 的两条都具备有效字段（`stage:assistant` + `duration`；
 * `stage:request` + `outputTokens`）—— 否则快照里的 `modelSpans` / `throughputTps`
 * 全是 `undefined`，名为覆盖实为空洞（CS06：不留"看起来通过"的假覆盖）。
 */
const SCENARIO: LiriEvent[] = [
  ev(1, "turn/start", { turn: 1 }),
  ev(2, "user/message", { content: "帮我看看这个文件" }),
  ev(3, "assistant/thinking", { content: "先读文件再回答" }),
  ev(4, "assistant/tool_call", {
    toolCallId: "call-1",
    name: "FileReadTool",
    arguments: { path: "src/app.ts" },
  }),
  ev(5, "tool/result", { toolCallId: "call-1", result: { ok: true } }),
  ev(6, "assistant/text", { content: "读完了，整体没问题" }),
  // 模型耗时：区间 = [time − duration, time]
  ev(7, "metric/timing", { stage: "assistant", duration: 2500 }),
  // 请求级用量：供聚合吞吐（500 / 2500ms × 1000 = 200 tps）
  ev(8, "metric/timing", { stage: "request", outputTokens: 500 }),
  ev(9, "turn/end", { turn: 1, finishReason: "stop" }),
  // turn 之外 ⇒ 归入 orphanEvents（锁住"孤立事件不丢也不并"）
  ev(10, "system/info", { message: "外部事件" }),
];

/** 时间文案归一化：`2026/9/23 12:34:56` → `DATE TIME`；`12:34:56` → `TIME` */
function normalizeTime(root: HTMLElement): string {
  return root.innerHTML
    .replace(/\d{4}\/\d{1,2}\/\d{1,2}/g, "DATE")
    .replace(/\d{2}:\d{2}:\d{2}/g, "TIME");
}

describe("轨迹快照 — 派生结果（P2-4）", () => {
  it("deriveTrajectoryLayout：Turn/Step/Cell 分组 + 孤立事件 + 退化计数", () => {
    expect(deriveTrajectoryLayout(SCENARIO)).toMatchSnapshot();
  });

  it("deriveTrajectoryTimeline：域 / 跨度 / 模型区间 / 吞吐 / 标记数", () => {
    expect(deriveTrajectoryTimeline(SCENARIO)).toMatchSnapshot();
  });

  it("flattenLayout：虚拟行结构指纹（turn 头与事件行交替）", () => {
    const layout = deriveTrajectoryLayout(SCENARIO);
    // 只取"行身份"，不重复快照事件正文（正文已在上面两处锁定）
    expect(
      flattenLayout(layout).map((row) =>
        row.kind === "turn-header"
          ? `turn-header:${row.turn.turn}`
          : `event:${row.event.seq}:${row.event.type}`,
      ),
    ).toMatchSnapshot();
  });
});

describe("轨迹快照 — 组件渲染（P2-4）", () => {
  it("TrajectoryRow：普通行（标签 + 预览 + 未选中态）", () => {
    const { container } = render(
      <TrajectoryRow event={SCENARIO[2]} selected={false} onClick={() => {}} />,
    );
    expect(normalizeTime(container)).toMatchSnapshot();
  });

  it("TrajectoryRow：metric/timing 行（耗时预览 + 选中态）", () => {
    const { container } = render(
      <TrajectoryRow event={SCENARIO[6]} selected onClick={() => {}} />,
    );
    expect(normalizeTime(container)).toMatchSnapshot();
  });

  it("TrajectoryDetail：工具事件（头部 + 参数/结果分区块 + JSON 展示）", () => {
    const { container } = render(
      <TrajectoryDetail event={SCENARIO[3]} onClose={() => {}} />,
    );
    expect(normalizeTime(container)).toMatchSnapshot();
  });
});
