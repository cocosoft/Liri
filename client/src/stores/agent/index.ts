/**
 * Agent Store — 智能体任务管理
 *
 * Phase 3: 从 agentStore.ts 拆分为两个独立 Slice：
 *   - AgentListStore: 任务列表 CRUD + 执行
 *   - AgentDetailStore: 任务详情 + 日志
 *
 * 本文件提供统一入口 useAgentStore，读取两个独立 Store 并处理跨 Store 联动。
 *
 * 迁移方案：import { useAgentStore } from '@/stores/agentStore' → from '@/stores/agent'
 */

import { useAgentListStore, type AgentListSlice } from "./agent-list.slice";
import {
  useAgentDetailStore,
  type AgentDetailSlice,
} from "./agent-config.slice";
import type { AgentTask, AgentProgress } from "@/types";

// ─── 组合接口（保持与原 agentStore 兼容）─────────────

export interface AgentStore extends AgentListSlice, AgentDetailSlice {
  // 原 agentStore 的完整接口，由两个独立 Store 组合
}

// ─── 跨 Store 联动的操作方法 ────────────────────────

/** updateTask 执行后同步 selectedTask */
async function updateTask(
  id: string,
  params: { name?: string; description?: string },
): Promise<void> {
  const list = useAgentListStore.getState();
  const detail = useAgentDetailStore.getState();
  await list.updateTask(id, params);

  // 从已更新的 list state 中读取最新的 task 并同步
  const updated = list.tasks.find((t) => t.id === id);
  if (updated && detail.selectedTask?.id === id) {
    detail.syncSelectedTask(updated);
  }
}

/** deleteTask 执行后清除 selectedTask */
async function deleteTask(id: string): Promise<void> {
  const detail = useAgentDetailStore.getState();
  await useAgentListStore.getState().deleteTask(id);

  if (detail.selectedTask?.id === id) {
    detail.syncSelectedTask(null);
  }
}

/** cancelTask 执行后同步 selectedTask */
async function cancelTask(id: string): Promise<void> {
  const detail = useAgentDetailStore.getState();
  await useAgentListStore.getState().cancelTask(id);

  if (detail.selectedTask?.id === id) {
    const current = detail.selectedTask;
    detail.syncSelectedTask(
      current ? ({ ...current, status: "failed" as const } as AgentTask) : null,
    );
  }
}

// ─── 统一入口 Hook ─────────────────────────────────

/**
 * 统一 Agent Store Hook
 *
 * 从两个独立 Store 读取状态，返回合并后的接口以保持与原 agentStore 兼容。
 * 跨 Store 联动方法（updateTask/deleteTask/cancelTask）自动同步 selectedTask。
 */
export function useAgentStore(): AgentStore {
  const listState = useAgentListStore();
  const detailState = useAgentDetailStore();

  return {
    // ─── AgentListStore ───
    tasks: listState.tasks,
    isLoading: listState.isLoading,
    error: listState.error,
    taskProgress: listState.taskProgress,
    loadTasks: listState.loadTasks,
    createTask: listState.createTask,
    executeTask: listState.executeTask,
    getTaskProgress: listState.getTaskProgress,

    // ─── 跨 Store 联动方法 ───
    updateTask,
    deleteTask,
    cancelTask,

    // ─── AgentDetailStore ───
    selectedTask: detailState.selectedTask,
    taskLogs: detailState.taskLogs,
    selectTask: detailState.selectTask,
    getTaskLogs: detailState.getTaskLogs,

    // ─── Detail sync ───
    syncSelectedTask: detailState.syncSelectedTask,
  };
}

// ─── 非 React 环境用 getState ──────────────────────

/** 非 React 环境获取 Agent 状态（等效原 useAgentStore.getState()） */
export function getAgentStoreState(): AgentStore {
  const list = useAgentListStore.getState();
  const detail = useAgentDetailStore.getState();

  return {
    ...list,
    selectedTask: detail.selectedTask,
    taskLogs: detail.taskLogs,
    selectTask: detail.selectTask,
    getTaskLogs: detail.getTaskLogs,
    syncSelectedTask: detail.syncSelectedTask,
    updateTask,
    deleteTask,
    cancelTask,
  };
}

// ─── 独立 Store 导出（高级用） ──────────────────────

export { useAgentListStore, useAgentDetailStore };
export type { AgentTask, AgentProgress };
