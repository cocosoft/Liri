import { create } from "zustand";

/**
 * resourceGovernorStore — 跨会话资源治理的**前端可见状态**（P26-1 前端相位 PC-2，2026-10-07）
 *
 * 数据源：后端全局 SSE `system:resource_governor`（`useNotificationSSE` 订阅）。
 * 用途：让用户**区分**"本会话被更高优先级任务抢占"与"自己中止"——被抢占的流由
 * `abortSessionStream` 中止且**不落检查点**（回复被丢弃），若无此状态前端无法给出原因。
 *
 * 状态口径（与后端 `GovernanceState` 对齐，CS02：结构化字段，非文案匹配）：
 * - `preempted`：保留提示条（供用户查看/关闭）；
 * - `queued`：保留提示条（排队中）；
 * - `released`：**删除**该会话条目（名额已移交 / 排队超时放行）。
 */

export type GovernanceState = "preempted" | "queued" | "released";

export interface GovernanceNotice {
  sessionId: string;
  state: GovernanceState;
  /** 排队位置（1-based；仅 `queued`） */
  queuePosition?: number;
  /** 事件到达时间（前端排序/去重参考） */
  at: number;
}

interface ResourceGovernorState {
  /** 按会话记录最近一次治理提示（`released` ⇒ 条目被删除） */
  notices: Record<string, GovernanceNotice>;
  /** 应用一条后端事件（字段做防御性解析；非法载荷忽略） */
  applyEvent: (raw: unknown) => void;
  /** 关闭指定会话的提示（用户手动关闭） */
  clear: (sessionId: string) => void;
}

export const useResourceGovernorStore = create<ResourceGovernorState>(
  (set, get) => ({
    notices: {},

    applyEvent: (raw) => {
      const event = (raw ?? {}) as {
        sessionId?: unknown;
        state?: unknown;
        queuePosition?: unknown;
      };
      const sessionId =
        typeof event.sessionId === "string" ? event.sessionId : "";
      if (!sessionId) return;

      const state = event.state;
      if (state !== "preempted" && state !== "queued" && state !== "released") {
        return;
      }

      const notices = { ...get().notices };
      if (state === "released") {
        delete notices[sessionId];
      } else {
        notices[sessionId] = {
          sessionId,
          state,
          queuePosition:
            typeof event.queuePosition === "number"
              ? event.queuePosition
              : undefined,
          at: Date.now(),
        };
      }
      set({ notices });
    },

    clear: (sessionId) => {
      if (!(sessionId in get().notices)) return; // 幂等
      const notices = { ...get().notices };
      delete notices[sessionId];
      set({ notices });
    },
  }),
);
