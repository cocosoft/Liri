/**
 * PlanTaskStore — PlanDrivenLoop TaskCard 实时状态存储
 *
 * P2（08-09）：独立于 chat store，通过 SSE 事件驱动更新。
 * TaskCard 组件通过 planId 查找对应数据，实现实时状态刷新。
 */
import { create } from "zustand";
import type { TaskCardData, TaskCardTask } from "@/types";
import { createLogger } from "@/utils/logger";

const logger = createLogger("planTaskStore");

interface PlanTaskState {
  /** planId → TaskCardData */
  tasks: Record<string, TaskCardData>;
  /** #3 竞态缓冲：plan:step_progress 先于 plan:task_card 到达时，暂存更新待 task_card 补发 */
  pendingUpdates: Record<
    string,
    Array<{ stepId: string; update: Partial<TaskCardTask> }>
  >;
  /** 设置或更新一个计划的 TaskCard 数据 */
  upsert: (planId: string, data: TaskCardData) => void;
  /** 更新单个任务状态 */
  updateTask: (
    planId: string,
    stepId: string,
    update: Partial<TaskCardTask>,
  ) => void;
  /** 移除计划 */
  remove: (planId: string) => void;
}

export const usePlanTaskStore = create<PlanTaskState>()((set, get) => ({
  tasks: {},
  pendingUpdates: {},

  upsert: (planId: string, data: TaskCardData) => {
    const prev = get().tasks[planId];
    logger.debug(
      `[upsert] planId=${planId} title="${data.title}" status=${data.status} tasks=${data.tasks.length} existed=${!!prev}`,
    );
    set((s) => ({
      tasks: { ...s.tasks, [planId]: data },
    }));
    // #3 修复：task_card 到达后补发竞态期间缓存的任务更新（step_progress 先到场景）
    const buf = get().pendingUpdates[planId];
    if (buf && buf.length > 0) {
      let merged = get().tasks[planId];
      for (const { stepId, update } of buf) {
        merged = {
          ...merged,
          tasks: merged.tasks.map((t) =>
            t.id === stepId ? { ...t, ...update } : t,
          ),
        };
      }
      logger.debug(
        `[upsert] 补发竞态缓存更新 ${buf.length} 条 planId=${planId}`,
      );
      set((s) => ({
        tasks: { ...s.tasks, [planId]: merged },
        pendingUpdates: { ...s.pendingUpdates, [planId]: [] },
      }));
    }
  },

  updateTask: (
    planId: string,
    stepId: string,
    update: Partial<TaskCardTask>,
  ) => {
    const current = get().tasks[planId];
    if (!current) {
      // #3 修复：task_card 尚未到达（SSE 事件乱序），缓存本次更新，upsert 时补发，
      // 原实现直接 return 导致首步完成事件静默丢失、任务永久显示"执行中"
      const buf = get().pendingUpdates[planId] || [];
      buf.push({ stepId, update });
      set((s) => ({
        pendingUpdates: { ...s.pendingUpdates, [planId]: buf },
      }));
      logger.debug(
        `[updateTask] planId=${planId} 未就绪，缓存更新 stepId=${stepId} status=${update.status ?? "?"}`,
      );
      return;
    }
    const task = current.tasks.find((t) => t.id === stepId);
    logger.debug(
      `[updateTask] planId=${planId} stepId=${stepId} ${task?.status ?? "?"}→${update.status ?? "?"} ${task?.name ?? "?"}`,
    );
    set((s) => ({
      tasks: {
        ...s.tasks,
        [planId]: {
          ...current,
          tasks: current.tasks.map((t) =>
            t.id === stepId ? { ...t, ...update } : t,
          ),
        },
      },
    }));
  },

  remove: (planId: string) => {
    const prev = get().tasks[planId];
    logger.debug(
      `[remove] planId=${planId} existed=${!!prev} totalPlans=${Object.keys(get().tasks).length}`,
    );
    set((s) => {
      const { [planId]: _, ...rest } = s.tasks;
      const { [planId]: _pending, ...pendingRest } = s.pendingUpdates;
      return { tasks: rest, pendingUpdates: pendingRest };
    });
  },
}));
