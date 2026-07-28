/**
 * ContextWatermarkStore — 上下文水位状态管理
 *
 * 监听 SSE 推送的 context_watermark / compaction_complete 事件，
 * 驱动 ContextWatermark 组件展示上下文膨胀状态。
 */

import { create } from "zustand";

export interface WatermarkState {
  currentTokens: number;
  contextLimit: number;
  ratio: number;
  severity: "normal" | "warn" | "compact";
}

export interface CompactionRecord {
  timestamp: number;
  tokensBefore: number;
  tokensAfter: number;
  savingsPercent: number;
  message: string;
}

export interface CumulativeStats {
  totalCompressions: number;
  totalTokensSaved: number;
  firstCompressionAt: number | null;
}

interface ContextWatermarkStore {
  /** 当前水位 */
  watermark: WatermarkState | null;
  /** 最近一次压缩记录 */
  lastCompaction: CompactionRecord | null;
  /** 累计压缩统计 */
  cumulative: CumulativeStats;

  updateWatermark: (state: WatermarkState) => void;
  recordCompaction: (record: Omit<CompactionRecord, "timestamp">) => void;
  reset: () => void;
}

export const useContextWatermarkStore = create<ContextWatermarkStore>(
  (set, get) => ({
    watermark: null,
    lastCompaction: null,
    cumulative: {
      totalCompressions: 0,
      totalTokensSaved: 0,
      firstCompressionAt: null,
    },

    updateWatermark: (state) => {
      const prev = get().watermark;
      // 仅当 prev 为空且无实际数据时才跳过（阻止初始空噪声，但允许正常的实时水位数据通过）
      if (
        state.severity === "normal" &&
        prev === null &&
        state.currentTokens === 0
      )
        return;
      // 同水位不重复更新（ratio 变化 < 1%）
      if (
        prev &&
        prev.severity === state.severity &&
        Math.abs(prev.ratio - state.ratio) < 0.01
      )
        return;
      set({ watermark: state });
    },

    recordCompaction: (record) => {
      const now = Date.now();
      const cum = get().cumulative;
      set({
        lastCompaction: { ...record, timestamp: now },
        cumulative: {
          totalCompressions: cum.totalCompressions + 1,
          totalTokensSaved:
            cum.totalTokensSaved + (record.tokensBefore - record.tokensAfter),
          firstCompressionAt: cum.firstCompressionAt ?? now,
        },
      });
    },

    reset: () => {
      set({
        watermark: null,
        lastCompaction: null,
        cumulative: {
          totalCompressions: 0,
          totalTokensSaved: 0,
          firstCompressionAt: null,
        },
      });
    },
  }),
);
