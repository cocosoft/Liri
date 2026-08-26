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

// 任务 3（P1）store 单测：增量 append、守卫 1-4、双轨 tailSeq 分页
// 覆盖 Spec 验收「流式期间轨迹列表实时增长无冻结；loadMore 分页无跳过/重复」
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTrajectoryStore } from "../trajectoryStore";
import { trajectoryService } from "@/services/trajectoryService";
import type { LiriEvent } from "@/types";

/** 构造最小事件（seq 升序、同会话） */
function mkEvent(seq: number): LiriEvent {
  return {
    type: "assistant/text",
    seq,
    time: 1000 + seq,
    sessionId: "s1",
    data: { content: `msg-${seq}` },
  } as unknown as LiriEvent;
}

let getEventsMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useTrajectoryStore.getState().reset();
  getEventsMock = vi.fn();
  trajectoryService.getEvents =
    getEventsMock as unknown as typeof trajectoryService.getEvents;
});

describe("trajectoryStore 双轨 tailSeq + 增量 append（任务 3）", () => {
  it("loadEvents 初始化：recent 尾部优先（长会话不再只看开头 1000 条），tailSeq/liveTailSeq 为后端返回值", async () => {
    getEventsMock.mockResolvedValueOnce({
      events: [mkEvent(1), mkEvent(2)],
      tailSeq: 2,
      hasMore: true,
    });

    await useTrajectoryStore.getState().loadEvents("s1");

    // P8（2026-08-26）：首次加载走 recent（尾部优先窗口），日志/轨迹面板显示最近事件
    expect(getEventsMock).toHaveBeenCalledWith("s1", {
      limit: 1000,
      recent: true,
    });
    const s = useTrajectoryStore.getState();
    expect(s.sessionId).toBe("s1");
    expect(s.events).toHaveLength(2);
    expect(s.tailSeq).toBe(2);
    expect(s.liveTailSeq).toBe(2);
    expect(s.hasMore).toBe(true);
  });

  it("setLiveEvents 增量 append：追加尾部新段、无重复、产生新数组；只更新 liveTailSeq，不动后端 tailSeq（双轨）", async () => {
    getEventsMock.mockResolvedValueOnce({
      events: [mkEvent(1), mkEvent(2), mkEvent(3)],
      tailSeq: 3,
      hasMore: true,
    });
    await useTrajectoryStore.getState().loadEvents("s1");

    const s0 = useTrajectoryStore.getState();
    const oldEventsRef = s0.events;

    // 流式推进：聚合器本地已到 seq 6，与后端分页 tailSeq=3 分叉
    useTrajectoryStore
      .getState()
      .setLiveEvents("s1", [1, 2, 3, 4, 5, 6].map(mkEvent), 6);

    const s = useTrajectoryStore.getState();
    expect(s.events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s.events).not.toBe(oldEventsRef); // 新数组（修复聚合器引用冻结）
    expect(s.liveTailSeq).toBe(6); // 聚合器本地值
    expect(s.tailSeq).toBe(3); // 双轨：后端分页值不被污染
  });

  it("守卫 1：sessionId 不匹配跳过（用户在看别的会话）", async () => {
    getEventsMock.mockResolvedValueOnce({
      events: [mkEvent(1)],
      tailSeq: 1,
      hasMore: false,
    });
    await useTrajectoryStore.getState().loadEvents("s1");

    const before = useTrajectoryStore.getState().events;
    useTrajectoryStore
      .getState()
      .setLiveEvents("s2", [mkEvent(1), mkEvent(2)], 2);

    const s = useTrajectoryStore.getState();
    expect(s.events).toBe(before);
    expect(s.liveTailSeq).toBe(1);
  });

  it("守卫 2：liveTailSeq 倒退（聚合器 reset 后空数据回写）拒绝覆盖", async () => {
    getEventsMock.mockResolvedValueOnce({
      events: [mkEvent(1), mkEvent(2)],
      tailSeq: 2,
      hasMore: false,
    });
    await useTrajectoryStore.getState().loadEvents("s1");

    useTrajectoryStore
      .getState()
      .setLiveEvents("s1", [1, 2, 3, 4, 5].map(mkEvent), 5);
    const before = useTrajectoryStore.getState().events;

    // 倒退：tailSeq=3 < liveTailSeq=5 → 拒绝
    useTrajectoryStore
      .getState()
      .setLiveEvents("s1", [1, 2, 3].map(mkEvent), 3);

    const s = useTrajectoryStore.getState();
    expect(s.events).toBe(before);
    expect(s.liveTailSeq).toBe(5);
  });

  it("守卫 3/4：同长度（无增量）与相同状态跳过", async () => {
    getEventsMock.mockResolvedValueOnce({
      events: [mkEvent(1), mkEvent(2), mkEvent(3)],
      tailSeq: 3,
      hasMore: false,
    });
    await useTrajectoryStore.getState().loadEvents("s1");

    const before = useTrajectoryStore.getState().events;
    // 守卫 4：incoming 长度 == store 长度（增量为空）→ 跳过
    useTrajectoryStore
      .getState()
      .setLiveEvents("s1", [1, 2, 3].map(mkEvent), 3);
    expect(useTrajectoryStore.getState().events).toBe(before);
    // 守卫 3：完全相同 → 跳过
    useTrajectoryStore
      .getState()
      .setLiveEvents("s1", [1, 2, 3].map(mkEvent), 3);
    expect(useTrajectoryStore.getState().events).toBe(before);
  });

  it("loadMore 只用 backendTailSeq（fromSeq = tailSeq + 1），不被 liveTailSeq 污染", async () => {
    getEventsMock.mockResolvedValueOnce({
      events: [mkEvent(1), mkEvent(2), mkEvent(3)],
      tailSeq: 3,
      hasMore: true,
    });
    await useTrajectoryStore.getState().loadEvents("s1");

    // 流式把 liveTailSeq 推到 6（与后端分页分叉），loadMore 仍须从后端 tailSeq+1 继续
    useTrajectoryStore
      .getState()
      .setLiveEvents("s1", [1, 2, 3, 4, 5, 6].map(mkEvent), 6);

    getEventsMock.mockResolvedValueOnce({
      events: [mkEvent(4), mkEvent(5), mkEvent(6), mkEvent(7), mkEvent(8)],
      tailSeq: 8,
      hasMore: false,
    });
    await useTrajectoryStore.getState().loadMore();

    // 分页基准是后端 tailSeq(3)+1=4，而非 liveTailSeq(6)+1=7
    expect(getEventsMock).toHaveBeenLastCalledWith("s1", {
      fromSeq: 4,
      limit: 1000,
    });
    const s = useTrajectoryStore.getState();
    expect(s.tailSeq).toBe(8);
    // 流式已追加的 4-6 与 loadMore 返回重叠 → 按 seq 去重，不重复
    expect(s.events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
