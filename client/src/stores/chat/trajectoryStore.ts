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
  /** 关键字（在 data.content / data.name / data.error 中模糊匹配） */
  keyword: string;
}

export interface TrajectoryState {
  /** 当前加载的会话 ID */
  sessionId: string | null;
  /** 全部事件（按 seq 升序） */
  events: LiriEvent[];
  /** 当前事件日志的 tailSeq */
  tailSeq: number;
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

  /** 加载指定会话的事件流 */
  loadEvents: (sessionId: string) => Promise<void>;
  /** 增量加载（fromTailSeq 之后） */
  loadMore: () => Promise<void>;
  /**
   * A2：流式实时同步（不改变 UI 状态：filter/selectedSeq/loading/error）。
   * 条件：仅当 sessionId 匹配时才替换（否则用户在看别的会话，不打扰）。
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
  /** 重置 */
  reset: () => void;
}

export const useTrajectoryStore = create<TrajectoryState>((set, get) => ({
  sessionId: null,
  events: [],
  tailSeq: 0,
  hasMore: false,
  loading: false,
  error: null,
  selectedSeq: null,
  filter: {
    categories: [],
    types: [],
    keyword: "",
  },

  loadEvents: async (sessionId: string) => {
    if (get().loading) return;
    set({ loading: true, error: null, sessionId });
    try {
      const result = await trajectoryService.getEvents(sessionId, {
        limit: 1000,
      });
      set({
        events: result.events,
        tailSeq: result.tailSeq,
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
      set((state) => ({
        events: [...state.events, ...result.events],
        tailSeq: result.tailSeq,
        hasMore: result.hasMore,
        loading: false,
      }));
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
    // 守卫 2：tailSeq 倒退/相等不覆盖（防止 aggregator.reset 后的异步回调把空数据写回来；
    //         也防止同一帧重复 setState 触发无意义重渲染）
    if (tailSeq < state.tailSeq) {
      logger.warn("[setLiveEvents] skip: tailSeq regression (倒退数据已拒绝)", {
        storeTailSeq: state.tailSeq,
        incomingTailSeq: tailSeq,
        incomingEventsLen: eventsLen,
        storeEventsLen: state.events.length,
      });
      return;
    }
    // 守卫 3：events/tailSeq 完全相同 → skip
    if (tailSeq === state.tailSeq && eventsLen === state.events.length) {
      logger.debug("[setLiveEvents] skip: same state (no-op)", {
        tailSeq,
        eventsLen,
      });
      return;
    }
    logger.debug("[setLiveEvents] apply", {
      beforeTailSeq: state.tailSeq,
      beforeEventsLen: state.events.length,
      incomingTailSeq: tailSeq,
      incomingEventsLen: eventsLen,
      deltaTail: tailSeq - state.tailSeq,
      deltaEvents: eventsLen - state.events.length,
    });
    set({
      events,
      tailSeq,
      // 显式保留：loading / error / filter / selectedSeq 一律不动
    });
  },

  selectEvent: (seq) => set({ selectedSeq: seq }),

  setFilter: (patch) =>
    set((state) => ({ filter: { ...state.filter, ...patch } })),

  reset: () =>
    set({
      sessionId: null,
      events: [],
      tailSeq: 0,
      hasMore: false,
      loading: false,
      error: null,
      selectedSeq: null,
      filter: { categories: [], types: [], keyword: "" },
    }),
}));
