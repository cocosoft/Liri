import { create } from "zustand";

/** 休眠检测提示（由后端 SSE system:sleep_detected 事件填充） */
export interface SleepNotice {
  /** 后端检测到的时间戳（去重依据） */
  detectedAt: number;
  /** 滞后时长（ms） */
  lagMs: number;
  /** 积压的定时任务数 */
  pendingCount: number;
}

interface SleepNoticeState {
  notice: SleepNotice | null;
  /** 设置提示（同一 detectedAt 去重） */
  setNotice: (n: SleepNotice) => void;
  clearNotice: () => void;
}

export const useSleepNoticeStore = create<SleepNoticeState>((set, get) => ({
  notice: null,
  setNotice: (n) => {
    const cur = get().notice;
    if (cur && cur.detectedAt === n.detectedAt) return; // 幂等去重
    set({ notice: n });
  },
  clearNotice: () => set({ notice: null }),
}));
