/**
 * Agent Detail Slice — 智能体任务详情 + 日志
 *
 * Phase 3: 从 agentStore.ts 拆分出任务详情管理（Domain B）。
 * 与 AgentListStore 并行运行，通过 useAgentStore (index.ts) 联动同步。
 */

import { create } from "zustand";
import type { AgentTask } from "@/types";
import { agentService } from "@/services/agentService";
import { createLogger } from "@/utils/logger";
import { handleClientError } from "@/utils/handleError";

const logger = createLogger("stores:agentDetail");

// ─── 接口 ─────────────────────────────────────────

export interface AgentDetailSlice {
  selectedTask: AgentTask | null;
  taskLogs: string[];

  selectTask: (task: AgentTask | null) => void;
  getTaskLogs: (id: string) => Promise<void>;
  /** 同步 selectedTask（供 AgentListStore update/delete/cancel 后联动） */
  syncSelectedTask: (updated: AgentTask | null) => void;
}

// ─── Store 实现 ──────────────────────────────────

export const useAgentDetailStore = create<AgentDetailSlice>((set, get) => ({
  selectedTask: null,
  taskLogs: [],

  /** 选中任务并加载日志 */
  selectTask: (task) => {
    set({ selectedTask: task });
    if (task) {
      get().getTaskLogs(task.id);
    }
  },

  /** 获取任务日志 */
  getTaskLogs: async (id) => {
    try {
      const logs = await agentService.getTaskLogs(id);
      set({ taskLogs: logs });
      logger.debug("任务日志加载完成", { taskId: id, logCount: logs.length });
    } catch (e) {
      handleClientError(e, { module: "stores:agent:config", action: "getTaskLogs" });
      logger.error("任务日志加载失败", { taskId: id, error: String(e) });
    }
  },

  /** 同步 selectedTask（external sync） */
  syncSelectedTask: (updated) => {
    set({ selectedTask: updated });
  },
}));
