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

  upsert: (planId: string, data: TaskCardData) => {
    const prev = get().tasks[planId];
    logger.debug(`[upsert] planId=${planId} title="${data.title}" status=${data.status} tasks=${data.tasks.length} existed=${!!prev}`);
    set((s) => ({
      tasks: { ...s.tasks, [planId]: data },
    }));
  },

  updateTask: (
    planId: string,
    stepId: string,
    update: Partial<TaskCardTask>,
  ) => {
    const current = get().tasks[planId];
    if (!current) {
      logger.warn(`[updateTask] planId=${planId} not found in store, stepId=${stepId} update=${JSON.stringify(update)}`);
      return;
    }
    const task = current.tasks.find((t) => t.id === stepId);
    logger.debug(`[updateTask] planId=${planId} stepId=${stepId} ${task?.status ?? "?"}→${update.status ?? "?"} ${task?.name ?? "?"}`);
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
    logger.debug(`[remove] planId=${planId} existed=${!!prev} totalPlans=${Object.keys(get().tasks).length}`);
    set((s) => {
      const { [planId]: _, ...rest } = s.tasks;
      return { tasks: rest };
    });
  },
}));