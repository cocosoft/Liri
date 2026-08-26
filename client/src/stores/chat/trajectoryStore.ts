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
 * 轨迹调试 Store — M1-7
 *
 * 独立 Zustand store（非 chat 主 store 的 slice），因为：
 * 1. 仅调试用，不影响主消息流
 * 2. 数据生命周期独立（按 sessionId 切换时整体替换）
 * 3. 避免主 store state 膨胀
 */

import { create } from "zustand";
import type { LiriEvent, LiriEventType } from "@/types";
import { trajectoryService } from "@/services/trajectoryService";
import { createLogger } from "@/utils/logger";

const logger = createLogger("trajectoryStore");

export interface TrajectoryFilterState {
  /** 按 category 过滤（多选，空数组 = 全部） */
  categories: string[];
  /** 按 type 精确过滤（多选，空数组 = 全部） */
  types: LiriEventType[];
  /** 关键字（在 data.content / data.name / data.error / data.result / data.toolCallId / data.turn / data.model 中模糊匹配） */
  keyword: string;
  /** P7（2026-08-25）：seq 区间过滤（可选） */
  minSeq?: number;
  maxSeq?: number;
  /** P7（2026-08-25）：时间范围过滤（毫秒时间戳，可选） */
  fromTime?: number;
  toTime?: number;
  /** P7（2026-08-25）：按来源过滤（llm / tool / system / channel / user，由 categorizeEvent 派生） */
  sources: string[];
}

export interface TrajectoryState {
  /** 当前加载的会话 ID */
  sessionId: string | null;
  /** 全部事件（按 seq 升序） */
  events: LiriEvent[];
  /**
   * 后端分页 tailSeq（loadEvents/loadMore 返回，驱动 loadMore 分页）。
   * P2 双轨（2026-08-25）：流式期间不再被聚合器本地值覆盖。
   */
  tailSeq: number;
  /**
   * 聚合器本地 liveTailSeq（setLiveEvents 传入，仅守卫/展示用）。
   * P2 双轨：与后端 tailSeq 分叉是常态，二者不得混用。
   */
  liveTailSeq: number;
  /** 是否还有更多（hasMore） */
  hasMore: boolean;
  /** 加载状态 */
  loading: boolean;
  /** 错误信息（仅失败时填充） */
  error: string | null;
  /** 当前展开详情的 seq */
  selectedSeq: number | null;
  /** 过滤状态 */
  filter: TrajectoryFilterState;

  // ── P6 回放播放器状态（2026-08-25，纯前端） ──
  /** 是否正在播放 */
  playing: boolean;
  /** 播放速度倍率（1x / 2x / 4x） */
  playbackSpeed: number;
  /** 当前播放位置（拍平行 index，由 TrajectoryTabContent 驱动） */
  playbackIndex: number;

  /** 加载指定会话的事件流 */
  loadEvents: (sessionId: string) => Promise<void>;
  /** 增量加载（fromSeq = backendTailSeq + 1） */
  loadMore: () => Promise<void>;
  /**
   * A2：流式实时同步（不改变 UI 状态：filter/selectedSeq/loading/error）。
   * 条件：仅当 sessionId 匹配时才替换（否则用户在看别的会话，不打扰）。
   * P2（2026-08-25）：改为按 length 增量追加（产生新数组，修复聚合器引用冻结 bug），
   * 只更新 liveTailSeq，不动后端 tailSeq。
   * 调用方：streamMessage 主循环，rAF 节流。
   */
  setLiveEvents: (
    sessionId: string,
    events: LiriEvent[],
    tailSeq: number,
  ) => void;
  /** 设置选中事件 */
  selectEvent: (seq: number | null) => void;
  /** 设置过滤 */
  setFilter: (patch: Partial<TrajectoryFilterState>) => void;
  /** P6：切换播放/暂停 */
  togglePlay: () => void;
  /** P6：设置播放速度 */
  setPlaybackSpeed: (speed: number) => void;
  /** P6：跳转到指定行（拖动进度条） */
  seekPlayback: (index: number) => void;
  /** P6：播放推进一行（由播放定时器驱动）；到底自动暂停 */
  advancePlayback: (totalRows: number) => void;
  /** 重置 */
  reset: () => void;
}

export const useTrajectoryStore = create<TrajectoryState>((set, get) => ({
  sessionId: null,
  events: [],
  tailSeq: 0,
  liveTailSeq: 0,
  hasMore: false,
  loading: false,
  error: null,
  selectedSeq: null,
  filter: {
    categories: [],
    types: [],
    keyword: "",
    sources: [],
  },
  playing: false,
  playbackSpeed: 1,
  playbackIndex: 0,

  loadEvents: async (sessionId: string) => {
    if (get().loading) return;
    set({ loading: true, error: null, sessionId });
    try {
      // P8（2026-08-26）：recent 尾部优先——长会话不再只看到开头 1000 条，
      // 日志/轨迹面板显示最近事件（loadMore 仍按后端 tailSeq 分页）
      const result = await trajectoryService.getEvents(sessionId, {
        limit: 1000,
        recent: true,
      });
      set({
        events: result.events,
        tailSeq: result.tailSeq,
        liveTailSeq: result.tailSeq,
        hasMore: result.hasMore,
        loading: false,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn("loadEvents 失败", { sessionId, error: msg });
      set({ loading: false, error: msg, events: [] });
    }
  },

  loadMore: async () => {
    const { sessionId, tailSeq, loading, hasMore } = get();
    if (!sessionId || loading || !hasMore) return;
    set({ loading: true });
    try {
      const result = await trajectoryService.getEvents(sessionId, {
        fromSeq: tailSeq + 1,
        limit: 1000,
      });
      set((state) => {
        // 双轨（P2）：流式期间 setLiveEvents 已追加的事件可能与 loadMore 返回重叠
        // （后端落盘与前端流式交错），按 seq 去重后再拼接——验收「loadMore 分页无重复」
        const seen = new Set(state.events.map((e) => e.seq));
        const fresh = result.events.filter((e) => !seen.has(e.seq));
        return {
          events: [...state.events, ...fresh],
          tailSeq: result.tailSeq,
          liveTailSeq: result.tailSeq,
          hasMore: result.hasMore,
          loading: false,
        };
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn("loadMore 失败", { sessionId, error: msg });
      set({ loading: false, error: msg });
    }
  },

  // A2：流式实时同步（会话匹配才生效，保留 UI 状态）
  setLiveEvents: (sessionId, events, tailSeq) => {
    const state = get();
    const eventsLen = events.length;
    // 守卫 1：用户在看别的会话，不打扰
    if (state.sessionId !== sessionId) {
      logger.debug("[setLiveEvents] skip: sessionId mismatch", {
        storeSessionId: state.sessionId,
        incomingSessionId: sessionId,
        incomingTailSeq: tailSeq,
        incomingEventsLen: eventsLen,
      });
      return;
    }
    // 守卫 2：liveTailSeq 倒退/相等不覆盖（防止 aggregator.reset 后的异步回调把空数据写回来；
    //         也防止同一帧重复 setState 触发无意义重渲染）
    if (tailSeq < state.liveTailSeq) {
      logger.warn("[setLiveEvents] skip: tailSeq regression (倒退数据已拒绝)", {
        storeLiveTailSeq: state.liveTailSeq,
        incomingTailSeq: tailSeq,
        incomingEventsLen: eventsLen,
        storeEventsLen: state.events.length,
      });
      return;
    }
    // 守卫 3：events/tailSeq 完全相同 → skip
    if (tailSeq === state.liveTailSeq && eventsLen === state.events.length) {
      logger.debug("[setLiveEvents] skip: same state (no-op)", {
        liveTailSeq: tailSeq,
        eventsLen,
      });
      return;
    }
    // 守卫 4（P2 新增）：增量为空（events 变短或相同长度但 liveTailSeq 相同）→ skip
    if (eventsLen <= state.events.length) {
      logger.debug("[setLiveEvents] skip: no delta (增量为空)", {
        storeEventsLen: state.events.length,
        incomingEventsLen: eventsLen,
        liveTailSeq: tailSeq,
      });
      return;
    }
    logger.debug("[setLiveEvents] apply incremental", {
      beforeEventsLen: state.events.length,
      incomingEventsLen: eventsLen,
      deltaEvents: eventsLen - state.events.length,
      liveTailSeq: tailSeq,
    });
    // P2：按 length 增量追加尾部新增段（产生新数组，修复聚合器内部数组引用冻结 bug）；
    // 只更新 liveTailSeq，后端 tailSeq 保持 loadEvents/loadMore 的值
    set((prev) => ({
      events: [...prev.events, ...events.slice(prev.events.length)],
      liveTailSeq: tailSeq,
      // 显式保留：loading / error / filter / selectedSeq / tailSeq 一律不动
    }));
  },

  selectEvent: (seq) => set({ selectedSeq: seq }),

  setFilter: (patch) =>
    set((state) => ({ filter: { ...state.filter, ...patch } })),

  // P6 回放播放器（2026-08-25）
  togglePlay: () => set((s) => ({ playing: !s.playing })),

  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),

  seekPlayback: (index) => set({ playbackIndex: index }),

  advancePlayback: (totalRows) =>
    set((s) => {
      const next = s.playbackIndex + 1;
      if (next >= totalRows) {
        // 播放到底自动暂停并回到末尾
        return { playing: false, playbackIndex: Math.max(0, totalRows - 1) };
      }
      return { playbackIndex: next };
    }),

  reset: () =>
    set({
      sessionId: null,
      events: [],
      tailSeq: 0,
      liveTailSeq: 0,
      hasMore: false,
      loading: false,
      error: null,
      selectedSeq: null,
      filter: { categories: [], types: [], keyword: "", sources: [] },
      playing: false,
      playbackSpeed: 1,
      playbackIndex: 0,
    }),
}));
