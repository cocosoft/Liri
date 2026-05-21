/**
 * TaskOrchestrator - 任务计划编排器
 *
 * 职责：
 * 1. 计划生成：接收描述 + 步骤列表，创建 Plan 对象并注册 Task 到 TaskRegistry
 * 2. 计划持久化：Plan 元数据持久化到 backend/data/plans/
 * 3. 步骤协调：提供步骤状态管理（pending → running → completed/failed）
 * 4. 进度追踪：查询计划整体进度、按状态分组
 * 5. 中断管理：终止所有活跃计划
 *
 * TaskOrchestrator 管理 Plan 元数据层（步骤描述、状态、结果），
 * 而 TaskRegistry 管理实际 BaseTask 生命周期。
 * 两者通过 taskId ↔ stepId 的映射关联。
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { taskRegistry } from './TaskRegistry';
import { NoteTask } from './NoteTask';
import { TaskStatus } from './types';

export interface PlanStep {
  id: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  taskId: string;
  result?: string;
  error?: string;
}

export interface Plan {
  id: string;
  description: string;
  steps: PlanStep[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'aborted';
  createdAt: string;
  completedAt?: string;
  sessionId: string;
}

export interface PlanProgress {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  percent: number;
}

let nextStepId = 1;
function generateStepId(): string {
  return `step_${nextStepId++}_${Date.now().toString(36)}`;
}

const PLANS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'data',
  'plans'
);

export class TaskOrchestrator {
  private plans: Map<string, Plan> = new Map();
  private initialized = false;

  /**
   * 从磁盘加载已持久化的计划
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    if (!existsSync(PLANS_DIR)) {
      mkdirSync(PLANS_DIR, { recursive: true });
      return;
    }

    const { readdir } = await import('node:fs/promises');
    let files: string[];
    try {
      files = await readdir(PLANS_DIR);
    } catch {
      return;
    }

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = join(PLANS_DIR, file);
      try {
        const data = readFileSync(filePath, 'utf-8');
        const plan = JSON.parse(data) as Plan;
        this.plans.set(plan.id, plan);
      } catch {
        // 跳过损坏的文件
      }
    }
  }

  private getPlanFilePath(planId: string): string {
    return join(PLANS_DIR, `plan_${planId}.json`);
  }

  private savePlan(plan: Plan): void {
    if (!existsSync(PLANS_DIR)) {
      mkdirSync(PLANS_DIR, { recursive: true });
    }
    try {
      writeFileSync(
        this.getPlanFilePath(plan.id),
        JSON.stringify(plan, null, 2),
        'utf-8'
      );
    } catch {
      // 持久化失败不应阻塞主流程
    }
  }

  private deletePlanFile(planId: string): void {
    const filePath = this.getPlanFilePath(planId);
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch {
      // 忽略清理失败
    }
  }

  /**
   * 创建计划：接收描述 + 步骤描述列表，注册任务到 TaskRegistry
   *
   * @param description 计划描述
   * @param stepDescriptions 步骤描述数组
   * @param sessionId 会话 ID
   * @param existingTaskIds 可选：已有任务 ID 列表（当任务已被 create_task_list 工具注册时使用）
   * @returns 创建的 Plan 对象
   */
  createPlan(
    description: string,
    stepDescriptions: string[],
    sessionId: string,
    existingTaskIds?: string[]
  ): Plan {
    void this.initialize();

    const planId = `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    const steps: PlanStep[] = stepDescriptions.map((desc, i) => {
      const taskId =
        existingTaskIds?.[i] ?? taskRegistry.registerNoteTask(desc).id;
      const stepId = generateStepId();
      return {
        id: stepId,
        description: desc,
        status: 'pending',
        taskId,
      };
    });

    const plan: Plan = {
      id: planId,
      description,
      steps,
      status: 'pending',
      createdAt: new Date().toISOString(),
      sessionId,
    };

    this.plans.set(planId, plan);
    this.savePlan(plan);
    return plan;
  }

  /**
   * 获取指定计划
   */
  getPlan(planId: string): Plan | undefined {
    return this.plans.get(planId);
  }

  /**
   * 获取所有计划
   */
  getAllPlans(): Plan[] {
    return Array.from(this.plans.values());
  }

  /**
   * 获取计划中待执行的步骤
   */
  getPendingSteps(planId: string): PlanStep[] {
    const plan = this.plans.get(planId);
    if (!plan) return [];
    return plan.steps.filter((s) => s.status === 'pending');
  }

  /**
   * 获取计划进度
   */
  getPlanProgress(planId: string): PlanProgress | undefined {
    const plan = this.plans.get(planId);
    if (!plan) return undefined;

    const total = plan.steps.length;
    let pending = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;
    let cancelled = 0;

    for (const step of plan.steps) {
      switch (step.status) {
        case 'pending':
          pending++;
          break;
        case 'running':
          running++;
          break;
        case 'completed':
          completed++;
          break;
        case 'failed':
          failed++;
          break;
        case 'cancelled':
          cancelled++;
          break;
      }
    }

    return {
      total,
      pending,
      running,
      completed,
      failed,
      cancelled,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }

  /**
   * 标记步骤为运行中，同步更新 TaskRegistry 中对应任务状态
   */
  markStepRunning(stepId: string): PlanStep | undefined {
    for (const plan of this.plans.values()) {
      const step = plan.steps.find((s) => s.id === stepId);
      if (!step) continue;

      step.status = 'running';
      plan.status = 'running';

      const task = taskRegistry.getTask(step.taskId);
      if (task && task instanceof NoteTask) {
        task.setStatusDirect(TaskStatus.RUNNING);
      }

      this.savePlan(plan);
      return step;
    }
    return undefined;
  }

  /**
   * 标记步骤为已完成，同步更新 TaskRegistry 中对应任务状态
   */
  markStepCompleted(stepId: string, result?: string): PlanStep | undefined {
    for (const plan of this.plans.values()) {
      const step = plan.steps.find((s) => s.id === stepId);
      if (!step) continue;

      step.status = 'completed';
      step.result = result;

      const task = taskRegistry.getTask(step.taskId);
      if (task && task instanceof NoteTask) {
        task.setStatusDirect(TaskStatus.COMPLETED);
      }

      // 检查是否所有步骤都已完成
      const allDone = plan.steps.every(
        (s) =>
          s.status === 'completed' ||
          s.status === 'failed' ||
          s.status === 'cancelled'
      );
      if (allDone) {
        plan.status = 'completed';
        plan.completedAt = new Date().toISOString();
      }

      this.savePlan(plan);
      return step;
    }
    return undefined;
  }

  /**
   * 标记步骤为失败，同步更新 TaskRegistry 中对应任务状态
   */
  markStepFailed(stepId: string, error?: string): PlanStep | undefined {
    for (const plan of this.plans.values()) {
      const step = plan.steps.find((s) => s.id === stepId);
      if (!step) continue;

      step.status = 'failed';
      step.error = error;

      const task = taskRegistry.getTask(step.taskId);
      if (task && task instanceof NoteTask) {
        task.setStatusDirect(TaskStatus.FAILED, error);
      }

      // 检查是否所有步骤都已终态
      const allDone = plan.steps.every(
        (s) =>
          s.status === 'completed' ||
          s.status === 'failed' ||
          s.status === 'cancelled'
      );
      if (allDone) {
        plan.status = 'completed';
        plan.completedAt = new Date().toISOString();
      }

      this.savePlan(plan);
      return step;
    }
    return undefined;
  }

  /**
   * 终止所有活跃计划中的运行中或待处理任务
   */
  async abortAll(): Promise<void> {
    for (const plan of this.plans.values()) {
      if (plan.status !== 'running' && plan.status !== 'pending') continue;

      for (const step of plan.steps) {
        if (step.status !== 'running' && step.status !== 'pending') continue;
        step.status = 'cancelled';

        const task = taskRegistry.getTask(step.taskId);
        if (task && task instanceof NoteTask) {
          task.setStatusDirect(TaskStatus.KILLED);
        } else if (task) {
          await task.kill().catch(() => {});
        }
      }

      plan.status = 'aborted';
      plan.completedAt = new Date().toISOString();
      this.savePlan(plan);
    }
  }

  /**
   * 保存所有计划到磁盘
   */
  async shutdown(): Promise<void> {
    for (const plan of this.plans.values()) {
      this.savePlan(plan);
    }
  }
}

export const taskOrchestrator = new TaskOrchestrator();
