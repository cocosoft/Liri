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
      hasEarlier: false,
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
      hasEarlier: false,
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
      hasEarlier: false,
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

/** [from, to] 闭区间的 seq 列表（补页场景需要"成一页"的规模） */
function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

// P1-1（2026-09-22）向前补页：长会话历史可达。
// 关键语义：**前插**且**不触碰 tailSeq/liveTailSeq**（否则会破坏 loadMore 续读起点与
// setLiveEvents 的 liveTailSeq 守卫）；补页后选择存活（selectedSeq 不被清掉）。
describe("trajectoryStore 向前补页 loadOlder（P1-1）", () => {
  it("前插更早一页：beforeSeq=当前最小 seq；顺序正确；tailSeq/liveTailSeq 不被污染", async () => {
    // 首次加载 = 尾部窗口 501..1000（长会话 recent 语义）
    getEventsMock.mockResolvedValueOnce({
      events: range(501, 1000).map(mkEvent),
      tailSeq: 1000,
      hasEarlier: true,
      hasMore: false,
    });
    await useTrajectoryStore.getState().loadEvents("s1");
    expect(useTrajectoryStore.getState().events[0].seq).toBe(501);
    expect(useTrajectoryStore.getState().hasEarlier).toBe(true);

    // 补页：更早一页 1..500
    getEventsMock.mockResolvedValueOnce({
      events: range(1, 500).map(mkEvent),
      tailSeq: 1000,
      hasEarlier: false,
      hasMore: true,
    });
    await useTrajectoryStore.getState().loadOlder();

    expect(getEventsMock).toHaveBeenLastCalledWith("s1", {
      beforeSeq: 501,
      limit: 1000,
    });
    const s = useTrajectoryStore.getState();
    expect(s.events).toHaveLength(1000);
    expect(s.events[0].seq).toBe(1); // 前插在头部
    expect(s.events[s.events.length - 1].seq).toBe(1000); // 尾部不变
    expect(s.hasEarlier).toBe(false); // 后端已无更早
    // 关键：尾部语义不被补页改动
    expect(s.tailSeq).toBe(1000);
    expect(s.liveTailSeq).toBe(1000);
  });

  it("去重（补页段与现有段重叠）+ 选择存活（selectedSeq 不被清掉）", async () => {
    getEventsMock.mockResolvedValueOnce({
      events: range(401, 500).map(mkEvent),
      tailSeq: 500,
      hasEarlier: true,
      hasMore: false,
    });
    await useTrajectoryStore.getState().loadEvents("s1");
    useTrajectoryStore.getState().selectEvent(450);

    // 后端返回 300..449（与现有 401..449 重叠一部分）
    getEventsMock.mockResolvedValueOnce({
      events: range(300, 449).map(mkEvent),
      tailSeq: 500,
      hasEarlier: true,
      hasMore: true,
    });
    await useTrajectoryStore.getState().loadOlder();

    const s = useTrajectoryStore.getState();
    const seqs = s.events.map((e) => e.seq);
    expect(seqs[0]).toBe(300);
    expect(seqs[seqs.length - 1]).toBe(500);
    expect(new Set(seqs).size).toBe(seqs.length); // 无重复
    expect(s.selectedSeq).toBe(450); // 选择存活
    expect(s.hasEarlier).toBe(true);
  });

  it("hasEarlier=false ⇒ loadOlder 不发请求（无更早历史）", async () => {
    getEventsMock.mockResolvedValueOnce({
      events: [mkEvent(1), mkEvent(2)],
      tailSeq: 2,
      hasEarlier: false,
      hasMore: false,
    });
    await useTrajectoryStore.getState().loadEvents("s1");

    await useTrajectoryStore.getState().loadOlder();

    expect(getEventsMock).toHaveBeenCalledTimes(1); // 仅 loadEvents
  });
});

// TC-1（2026-09-23）：补齐"增量为空守卫 / 筛选合并 / 回放播放器"未覆盖分支
describe("trajectoryStore 守卫 4 + 筛选 + 回放播放器（TC-1 补齐）", () => {
  it("setLiveEvents 增量为空（同长度）⇒ skip，events 引用不变", () => {
    useTrajectoryStore
      .getState()
      .setLiveEvents("s1", [mkEvent(1), mkEvent(2)], 2);
    const before = useTrajectoryStore.getState().events;

    useTrajectoryStore
      .getState()
      .setLiveEvents("s1", [mkEvent(1), mkEvent(2)], 2);

    expect(useTrajectoryStore.getState().events).toBe(before);
  });

  it("setFilter 合并 patch：不覆盖未涉及的维度", () => {
    useTrajectoryStore.getState().setFilter({ keyword: "abc" });
    useTrajectoryStore.getState().setFilter({ categories: ["tool"] });

    const f = useTrajectoryStore.getState().filter;
    expect(f.keyword).toBe("abc");
    expect(f.categories).toEqual(["tool"]);
  });

  it("播放器：播放/暂停切换、倍速、定位", () => {
    expect(useTrajectoryStore.getState().playing).toBe(false);

    useTrajectoryStore.getState().togglePlay();
    expect(useTrajectoryStore.getState().playing).toBe(true);
    useTrajectoryStore.getState().togglePlay();
    expect(useTrajectoryStore.getState().playing).toBe(false);

    useTrajectoryStore.getState().setPlaybackSpeed(4);
    expect(useTrajectoryStore.getState().playbackSpeed).toBe(4);

    useTrajectoryStore.getState().seekPlayback(7);
    expect(useTrajectoryStore.getState().playbackIndex).toBe(7);
  });

  it("advancePlayback：未到底 +1；到底自动暂停并回到末尾", () => {
    useTrajectoryStore.getState().seekPlayback(0);
    useTrajectoryStore.getState().advancePlayback(5);
    expect(useTrajectoryStore.getState().playbackIndex).toBe(1);

    useTrajectoryStore.getState().seekPlayback(4);
    useTrajectoryStore.getState().advancePlayback(5); // 4+1 >= 5 ⇒ 到底

    const s = useTrajectoryStore.getState();
    expect(s.playing).toBe(false);
    expect(s.playbackIndex).toBe(4); // max(0, totalRows - 1)
  });
});

// P2-6（2026-09-23）：会话维度隔离 —— 选择/回放状态不得跨会话存活
describe("trajectoryStore 会话维度隔离（P2-6）", () => {
  const twoEvents = {
    events: [mkEvent(1), mkEvent(2)],
    tailSeq: 2,
    hasEarlier: false,
    hasMore: false,
  };

  it("切换会话 ⇒ 会话作用域 UI 状态失效（selectedSeq/playbackIndex/playing 重置）", async () => {
    getEventsMock.mockResolvedValue(twoEvents);
    await useTrajectoryStore.getState().loadEvents("s1");
    useTrajectoryStore.getState().selectEvent(2);
    useTrajectoryStore.getState().seekPlayback(1);
    useTrajectoryStore.getState().togglePlay();
    expect(useTrajectoryStore.getState().selectedSeq).toBe(2);

    await useTrajectoryStore.getState().loadEvents("s2"); // 切会话

    const s = useTrajectoryStore.getState();
    expect(s.selectedSeq).toBeNull();
    expect(s.playbackIndex).toBe(0);
    expect(s.playing).toBe(false);
  });

  it("同会话重新加载 ⇒ 保留选择（不误清用户选择）", async () => {
    getEventsMock.mockResolvedValue(twoEvents);
    await useTrajectoryStore.getState().loadEvents("s1");
    useTrajectoryStore.getState().selectEvent(1);
    useTrajectoryStore.getState().seekPlayback(1);

    await useTrajectoryStore.getState().loadEvents("s1"); // 同会话

    const s = useTrajectoryStore.getState();
    expect(s.selectedSeq).toBe(1);
    expect(s.playbackIndex).toBe(1);
  });
});
