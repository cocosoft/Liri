/**
 * TaskOrchestrator - 任务计划编排器
 *
 * 职责：
 * 1. 计划生成：接收描述 + 步骤列表，创建 Plan 对象并注册 Task 到 TaskRegistry
 * 2. 计划持久化：Plan 元数据持久化到 app/data/plans/
 * 3. 步骤协调：提供步骤状态管理（pending → running → completed/failed）
 * 4. 进度追踪：查询计划整体进度、按状态分组
 * 5. 中断管理：终止所有活跃计划
 *
 * TaskOrchestrator 管理 Plan 元数据层（步骤描述、状态、结果），
 * 而 TaskRegistry 管理实际 BaseTask 生命周期。
 * 两者通过 taskId ↔ stepId 的映射关联。
 */

import { join } from 'path';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'fs';
import { taskRegistry } from './TaskRegistry';
import { resolveDataSubDir } from '@modules/core';
import { NoteTask } from './NoteTask';
import { TaskStatus } from './types';
import type { PlanReview } from './PlanReview';
import type { ReviewDecision } from './PlanReview';

import { globalEventBus } from '../core/events/EventBus.js';
import { OrchestrationEventType as OrchEvent } from '../agent/events/OrchestrationEvents.js';
import type { PlanProgressData } from '../agent/events/OrchestrationEvents.js';

import { getLogger } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';
const logger = getLogger('tasks:TaskOrchestrator');

/**
 * 安全发布 EventBus 事件：失败时记录区分事件类型的日志，不阻塞主流程
 */
function safePublish(event: string, payload: Record<string, unknown>): void {
  try {
    globalEventBus.publish(event as any, payload);
  } catch (err) {
    void handleError(err, {
      module: 'tasks:TaskOrchestrator',
      action: 'safePublish',
      context: { event },
    });
  }
}

export interface PlanStep {
  id: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  taskId: string;
  /** P2（08-09）：前置依赖步骤 ID 列表，供 DAG 可视化 */
  dependsOn?: string[];
  result?: string;
  error?: string;
  /** PDCA：验收标准 */
  acceptanceCriteria?: string;
  /** PDCA：审查结果 */
  reviewResult?: PlanReview;
  /** PDCA：重试计数 */
  retryCount: number;
  /** PDCA：最大重试次数（默认 3） */
  maxRetries: number;
  /** PDCA：决策 */
  decision?: ReviewDecision;
}

export interface Plan {
  id: string;
  description: string;
  steps: PlanStep[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'aborted';
  createdAt: string;
  completedAt?: string;
  sessionId: string;
  /** 所属工作空间（项目）ID，用于项目编排面板隔离；无项目归属时省略 */
  workspaceId?: string;
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

const PLANS_DIR = resolveDataSubDir('plans');

export class TaskOrchestrator {
  private plans: Map<string, Plan> = new Map();
  private initialized = false;
  /** stepId → Plan 索引，O(1) 查找替代 O(n²) 遍历 */
  private stepIndex: Map<string, Plan> = new Map();
  /** 进度事件节流：记录每个 plan 上次发射时间，防止事件风暴 */
  private lastProgressEmit: Map<string, number> = new Map();
  /** 计划持久化目录，默认用户数据目录；测试可通过 setPlansDir 指向临时目录避免污染 */
  private plansDir: string = PLANS_DIR;

  /**
   * 覆盖计划持久化目录（测试隔离用）
   * 将计划写入指向临时目录，避免自动化测试污染用户数据。
   * 生产代码不调用。
   */
  setPlansDir(dir: string): void {
    this.plansDir = dir;
  }

  /**
   * 从磁盘加载已持久化的计划
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    if (!existsSync(this.plansDir)) {
      mkdirSync(this.plansDir, { recursive: true });
      return;
    }

    const { readdir } = await import('fs/promises');
    let files: string[];
    try {
      files = await readdir(this.plansDir);
    } catch (e) {
      await handleError(e, {
        module: 'tasks:TaskOrchestrator',
        action: 'readPlansDir',
      });
      return;
    }

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = join(this.plansDir, file);
      try {
        const data = readFileSync(filePath, 'utf-8');
        const plan = JSON.parse(data) as Plan;
        this.plans.set(plan.id, plan);
        this.buildStepIndex(plan);
      } catch (err) {
        // 跳过损坏的文件（非关键路径）
        await handleError(err, {
          module: 'tasks:TaskOrchestrator',
          action: 'parsePlanFile',
          context: { file },
        });
      }
    }
  }

  private getPlanFilePath(planId: string): string {
    return join(this.plansDir, `plan_${planId}.json`);
  }

  /** 构建 stepId → Plan 索引 */
  private buildStepIndex(plan: Plan): void {
    for (const step of plan.steps) {
      this.stepIndex.set(step.id, plan);
    }
  }

  /** O(1) 通过 stepId 查找所属 Plan */
  private getPlanByStepId(stepId: string): Plan | undefined {
    return this.stepIndex.get(stepId);
  }

  private savePlan(plan: Plan): void {
    if (!existsSync(this.plansDir)) {
      mkdirSync(this.plansDir, { recursive: true });
    }
    const filePath = this.getPlanFilePath(plan.id);
    const tmpPath = filePath + '.tmp';
    try {
      // 原子写入：先写临时文件，再重命名，防止写一半时进程崩溃导致文件损坏
      writeFileSync(tmpPath, JSON.stringify(plan, null, 2), 'utf-8');
      const { renameSync } = require('fs');
      renameSync(tmpPath, filePath);
    } catch (err) {
      // 持久化失败不应阻塞主流程
      void handleError(err, {
        module: 'tasks:TaskOrchestrator',
        action: 'savePlan',
        context: { planId: plan.id },
      });
    }
  }

  private deletePlanFile(planId: string): void {
    const filePath = this.getPlanFilePath(planId);
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch (err) {
      // 忽略清理失败
      void handleError(err, {
        module: 'tasks:TaskOrchestrator',
        action: 'deletePlanFile',
        context: { planId },
      });
    }
  }

  /**
   * 创建计划：接收描述 + 步骤描述列表，注册任务到 TaskRegistry
   *
   * @param description 计划描述
   * @param stepDescriptions 步骤描述数组
   * @param sessionId 会话 ID
   * @param existingTaskIds 可选：已有任务 ID 列表（当任务已被 create_task_list 工具注册时使用）
   * @param acceptanceCriteria 可选：每步的验收标准列表
   * @param workspaceId 可选：所属工作空间（项目）ID，用于项目编排面板隔离
   * @returns 创建的 Plan 对象
   */
  createPlan(
    description: string,
    stepDescriptions: string[],
    sessionId: string,
    existingTaskIds?: string[],
    acceptanceCriteria?: string[],
    workspaceId?: string
  ): Plan {
    void this.initialize();

    const planId = `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    const otel = getOTelTracing();
    const span = otel.startSpan('plan.create', {
      'plan.id': planId,
      'session.id': sessionId,
      'plan.steps': stepDescriptions.length,
    });

    const steps: PlanStep[] = stepDescriptions.map((desc, i) => {
      const taskId =
        existingTaskIds?.[i] ?? taskRegistry.registerNoteTask(desc).id;
      const stepId = generateStepId();
      return {
        id: stepId,
        description: desc,
        status: 'pending' as const,
        taskId,
        retryCount: 0,
        maxRetries: 3,
        acceptanceCriteria: acceptanceCriteria?.[i],
      };
    });

    const plan: Plan = {
      id: planId,
      description,
      steps,
      status: 'pending',
      createdAt: new Date().toISOString(),
      sessionId,
      workspaceId,
    };

    this.plans.set(planId, plan);
    this.savePlan(plan);

    // 发射计划开始事件
    safePublish(OrchEvent.PLAN_START, {
      planId,
      description,
      totalSteps: steps.length,
    });

    otel.endSpan(span, SpanStatusCode.OK);
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
   * 获取指定工作空间（项目）下的计划
   */
  getPlansByWorkspace(workspaceId: string): Plan[] {
    return Array.from(this.plans.values()).filter(
      (p) => p.workspaceId === workspaceId
    );
  }

  /**
   * 通过会话 ID 解析所属工作空间（项目）ID
   * 从会话 metadata.workspaceId 读取；会话不存在或未关联项目时返回 undefined
   */
  async resolveWorkspaceId(sessionId: string): Promise<string | undefined> {
    if (!sessionId) return undefined;
    try {
      const { createSessionGateway } =
        await import('@modules/session');
      const session = await createSessionGateway().getSession(sessionId);
      return session?.metadata?.workspaceId;
    } catch (err) {
      void handleError(err, {
        module: 'tasks:TaskOrchestrator',
        action: 'resolveWorkspaceId',
        context: { sessionId },
      });
      return undefined;
    }
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
    const plan = this.getPlanByStepId(stepId);
    if (!plan) return undefined;

    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) return undefined;

    step.status = 'running';
    plan.status = 'running';

    const task = taskRegistry.getTask(step.taskId);
    if (task && task instanceof NoteTask) {
      task.setStatusDirect(TaskStatus.RUNNING);
    }

    this.savePlan(plan);

    // 发射步骤开始事件
    safePublish(OrchEvent.PLAN_STEP_START, {
      planId: plan.id,
      stepIndex: plan.steps.indexOf(step),
      stepName: step.description,
      description: step.description,
    });

    return step;
  }

  /**
   * 标记步骤为已完成，同步更新 TaskRegistry 中对应任务状态
   */
  markStepCompleted(stepId: string, result?: string): PlanStep | undefined {
    const plan = this.getPlanByStepId(stepId);
    if (!plan) return undefined;

    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) return undefined;

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

    safePublish(OrchEvent.PLAN_STEP_COMPLETED, {
      planId: plan.id,
      stepIndex: plan.steps.indexOf(step),
      result,
    });

    this.emitPlanProgress(plan);
    if (allDone) {
      this.emitPlanCompleted(plan);
    }

    return step;
  }

  /**
   * 标记步骤为失败，同步更新 TaskRegistry 中对应任务状态
   */
  markStepFailed(stepId: string, error?: string): PlanStep | undefined {
    const plan = this.getPlanByStepId(stepId);
    if (!plan) return undefined;

    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) return undefined;

    // BUG-3 修复（2026-08-23）：幂等——已终态步骤不重复覆盖（防止中止后
    // runCollect 抛错把 cancelled 误标为 failed）
    if (
      step.status === 'completed' ||
      step.status === 'failed' ||
      step.status === 'cancelled'
    ) {
      return step;
    }

    step.status = 'failed';
    step.error = error;

    const task = taskRegistry.getTask(step.taskId);
    if (task && task instanceof NoteTask) {
      task.setStatusDirect(TaskStatus.FAILED, error);
    }

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

    safePublish(OrchEvent.PLAN_STEP_COMPLETED, {
      planId: plan.id,
      stepIndex: plan.steps.indexOf(step),
      result: error,
    });

    this.emitPlanProgress(plan);
    if (allDone) {
      this.emitPlanCompleted(plan);
    }

    return step;
  }

  /**
   * 标记步骤为已取消（BUG-3 修复，2026-08-23）：用户主动中止时终态化当前步骤，
   * 区别于 failed（异常中止）。幂等：已终态步骤不重复处理。
   */
  markStepCancelled(stepId: string, reason?: string): PlanStep | undefined {
    const plan = this.getPlanByStepId(stepId);
    if (!plan) return undefined;

    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) return undefined;
    // 幂等：已终态（completed/failed/cancelled）不重复处理
    if (
      step.status === 'completed' ||
      step.status === 'failed' ||
      step.status === 'cancelled'
    ) {
      return step;
    }

    step.status = 'cancelled';
    if (reason) step.error = reason;

    const task = taskRegistry.getTask(step.taskId);
    if (task && task instanceof NoteTask) {
      task.setStatusDirect(TaskStatus.KILLED);
    }

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

    safePublish(OrchEvent.PLAN_STEP_COMPLETED, {
      planId: plan.id,
      stepIndex: plan.steps.indexOf(step),
      result: reason,
    });

    this.emitPlanProgress(plan);
    if (allDone) {
      this.emitPlanCompleted(plan);
    }

    return step;
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
          await task.kill().catch((e) => {
            void handleError(e, {
              module: 'tasks:TaskOrchestrator',
              action: 'abort_killTask',
              context: { stepId: step.id, taskId: step.taskId },
            });
          });
        }
      }

      plan.status = 'aborted';
      plan.completedAt = new Date().toISOString();
      this.savePlan(plan);

      // 发射计划完成事件（中断）
      this.emitPlanCompleted(plan);
    }
  }

  /**
   * 发射计划进度事件（节流：同一 plan ≥ 200ms 间隔，防止事件风暴）
   */
  private emitPlanProgress(plan: Plan): void {
    const now = Date.now();
    const last = this.lastProgressEmit.get(plan.id) ?? 0;
    if (now - last < 200) return; // 节流

    const progress = this.getPlanProgress(plan.id);
    if (!progress) return;

    this.lastProgressEmit.set(plan.id, now);
    const payload: PlanProgressData = {
      planId: plan.id,
      completedSteps: progress.completed,
      totalSteps: progress.total,
      percentage: progress.percent,
    };
    safePublish(
      OrchEvent.PLAN_PROGRESS,
      payload as unknown as Record<string, unknown>
    );
  }

  /**
   * 发射计划完成事件
   */
  private emitPlanCompleted(plan: Plan): void {
    safePublish(OrchEvent.PLAN_COMPLETED, {
      planId: plan.id,
      totalSteps: plan.steps.length,
      completedSteps: plan.steps.filter((s) => s.status === 'completed').length,
      failedSteps: plan.steps.filter((s) => s.status === 'failed').length,
      status: plan.status,
    });
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
