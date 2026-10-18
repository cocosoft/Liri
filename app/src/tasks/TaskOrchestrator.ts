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
// C1（2026-10-09）：plan id 熵源改用 crypto
import { randomIdSuffix } from '../utils/common';
import type {
  ISnapshotCapable,
  SnapshotHandle,
  SnapshotFreezeScope,
} from '../utils/toolContract/Tool.js';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  unlinkSync,
} from 'fs';
import { taskRegistry } from './TaskRegistry';
import { configManager } from '@modules/config';
import {
  resolveDataSubDir,
  parseSuccessCriteria,
  type SuccessCriteria,
} from '@modules/core';
import { NoteTask } from './NoteTask';
import { TaskStatus } from './types';
import type { PlanReview } from './PlanReview';
import type { ReviewDecision } from './PlanReview';

import { globalEventBus } from '../core/events/EventBus.js';
import { OrchestrationEventType as OrchEvent } from '@modules/agent';
import type { PlanProgressData } from '@modules/agent';

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
  /** P1-3（2026-09-06，Teamwork）：失败路线保留——终败前已产出的轨迹/文本片段
   * （末条 assistant 文本 + objection 摘要），供重试（P0-2）与终局综合引用，不随失败丢失 */
  partialOutput?: string;
  /** E1①（2026-09-05，方案甲）：本步骤执行终局终止原因（max_turns/loop_detected/...） */
  terminationReason?: string;
  /** PDCA：验收标准（自由文本，保留兼容；结构化派生见 `successCriteria`） */
  acceptanceCriteria?: string;
  /**
   * 13-P0-2（2026-10-05）：由 `acceptanceCriteria` 文本解析出的**结构化验收标准**，
   * 作为验证器 `checks[]` 的判定骨架（见 `core/successCriteria.ts`）。
   */
  successCriteria?: SuccessCriteria;
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
  /**
   * U-02（2026-10-17）：最近一次心跳（ISO 时间）。
   *
   * 由 `savePlan` 在每次持久化时写入；恢复加载时用于区分“刚创建/仍在推进的
   * running 计划”与“崩溃残留的幽灵计划”。旧数据缺失该字段时回退 createdAt。
   */
  lastHeartbeatAt?: string;
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

export class TaskOrchestrator implements ISnapshotCapable {
  /** U-14：可挂起能力标记（字面量 true；探测见 `isSnapshotCapable()`） */
  readonly snapshotCapable = true as const;

  private plans: Map<string, Plan> = new Map();
  private initialized = false;
  /** stepId → Plan 索引，O(1) 查找替代 O(n²) 遍历 */
  private stepIndex: Map<string, Plan> = new Map();
  /** 进度事件节流：记录每个 plan 上次发射时间，防止事件风暴 */
  private lastProgressEmit: Map<string, number> = new Map();
  /** 计划持久化目录，默认用户数据目录；测试可通过 setPlansDir 指向临时目录避免污染 */
  private plansDir: string = PLANS_DIR;

  /**
   * U-14：冻结内存中的计划与步骤索引（可序列化句柄）。
   *
   * 只做**内存态**快照，不写盘、不改 `Plan` 结构；中心层只做不透明搬运。
   *
   * **按会话过滤**（阶段 1.3）：传 `scope.sessionId` 时只冻结该会话的计划 —— 挂起中心按
   * 会话挂起，全量快照在恢复时会覆盖其它仍在运行的会话。缺省保持旧的全量语义。
   */
  freezeForSuspend(scope?: SnapshotFreezeScope): SnapshotHandle {
    const sessionId = scope?.sessionId;
    const plans = [...this.plans.values()]
      .filter((p) => sessionId === undefined || p.sessionId === sessionId)
      .map((p) => JSON.parse(JSON.stringify(p)) as Plan);
    return {
      kind: 'task-orchestrator',
      version: 2,
      mode: sessionId === undefined ? 'full' : 'session',
      ...(sessionId !== undefined ? { sessionId } : {}),
      capturedAt: Date.now(),
      plans,
    };
  }

  /**
   * U-14：从快照恢复内存态计划（重建 stepIndex；不写盘，避免把冻结态误当持久化事实）。
   *
   * `mode='full'`（缺省，兼容 v1 句柄）⇒ 整体覆盖并标记已初始化；
   * `mode='session'` ⇒ **只覆盖该会话的计划**，其它计划原样保留（也不改 `initialized`，
   * 否则会跳过尚未加载的磁盘计划）。
   */
  resumeFromSnapshot(handle: SnapshotHandle): void {
    if (handle.kind !== 'task-orchestrator' || !Array.isArray(handle.plans)) {
      throw new Error('invalid task-orchestrator snapshot handle');
    }
    const plans = handle.plans as Plan[];
    const scoped = handle.mode === 'session';
    if (scoped) {
      if (
        typeof handle.sessionId !== 'string' ||
        handle.sessionId.length === 0
      ) {
        throw new Error('invalid task-orchestrator snapshot handle');
      }
      // 作用域恢复 = 该会话的计划集合**恰好**回到快照：先清掉快照之后新建的计划
      const keep = new Set(
        plans
          .filter((p) => p && p.sessionId === handle.sessionId)
          .map((p) => p.id)
      );
      for (const [planId, plan] of this.plans) {
        if (plan.sessionId === handle.sessionId && !keep.has(planId)) {
          this.dropStepIndex(planId);
          this.plans.delete(planId);
          this.lastProgressEmit.delete(planId);
        }
      }
    } else {
      this.plans.clear();
      this.stepIndex.clear();
      this.lastProgressEmit.clear();
    }
    for (const plan of plans) {
      if (!plan || typeof plan.id !== 'string') continue;
      // 作用域快照只允许恢复被冻结的那个会话（防御句柄内混入其它会话）
      if (scoped && plan.sessionId !== handle.sessionId) continue;
      const restored = JSON.parse(JSON.stringify(plan)) as Plan;
      if (scoped) this.dropStepIndex(restored.id);
      this.plans.set(restored.id, restored);
      this.buildStepIndex(restored);
    }
    // 全量快照已完整覆盖内存态 ⇒ 后续 createPlan 不应再从磁盘合并旧计划
    if (!scoped) this.initialized = true;
  }

  /**
   * 覆盖计划持久化目录（测试隔离用）
   * 将计划写入指向临时目录，避免自动化测试污染用户数据。
   * 生产代码不调用。
   */
  setPlansDir(dir: string): void {
    this.plansDir = dir;
  }

  /**
   * 从磁盘加载已持久化的计划（保留 async 签名给既有调用方）。
   *
   * U-02（2026-10-17）：内部改为**同步**加载 —— `createPlan` 等同步路径必须
   * 在创建计划前完成加载，否则加载过程会与新计划交叉（ghost 判定误杀/覆盖）。
   */
  async initialize(): Promise<void> {
    this.ensureInitializedSync();
  }

  /** 同步加载（唯一实现）：createPlan 与执行路径在入口调用。 */
  private ensureInitializedSync(): void {
    if (this.initialized) return;
    this.initialized = true;

    if (!existsSync(this.plansDir)) {
      mkdirSync(this.plansDir, { recursive: true });
      return;
    }

    let files: string[];
    try {
      files = readdirSync(this.plansDir);
    } catch (e) {
      void handleError(e, {
        module: 'tasks:TaskOrchestrator',
        action: 'readPlansDir',
      });
      return;
    }

    const graceMs = this.resolveGhostGraceMs();
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = join(this.plansDir, file);
      try {
        const data = readFileSync(filePath, 'utf-8');
        const plan = JSON.parse(data) as Plan;
        this.plans.set(plan.id, plan);
        this.buildStepIndex(plan);
        // U-02（2026-10-17）：ghost plan 防御收窄 ——
        // ① 仅 `running` 参与（`pending` 无活跃执行方是正常态，不得加载期直接 abort）；
        // ② 必须**心跳过期**（默认 10 分钟；旧数据回退 createdAt）才判定为崩溃残留。
        const hasActiveStep = plan.steps.some((s) => s.status === 'running');
        const heartbeatMs = Date.parse(plan.lastHeartbeatAt ?? plan.createdAt);
        const stale =
          !Number.isFinite(heartbeatMs) || Date.now() - heartbeatMs > graceMs;
        if (plan.status === 'running' && !hasActiveStep && stale) {
          logger.warn(
            '恢复时终结 ghost plan（running 且心跳过期/无活跃步骤）',
            {
              planId: plan.id,
              status: plan.status,
              lastHeartbeatAt: plan.lastHeartbeatAt ?? null,
              graceMs,
              stepStatuses: plan.steps.map((s) => s.status),
            }
          );
          plan.status = 'aborted';
          plan.completedAt = plan.completedAt ?? new Date().toISOString();
          this.savePlan(plan);
        }
      } catch (err) {
        // 跳过损坏的文件（非关键路径）
        void handleError(err, {
          module: 'tasks:TaskOrchestrator',
          action: 'parsePlanFile',
          context: { file },
        });
      }
    }
  }

  /** ghost 宽限期（ms）：默认 10 分钟，可用 `TASK_GOAL_GHOST_GRACE_MS` 覆盖。 */
  private resolveGhostGraceMs(): number {
    const raw = Number(configManager.env('TASK_GOAL_GHOST_GRACE_MS'));
    return Number.isFinite(raw) && raw > 0 ? raw : 10 * 60_000;
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

  /** U-14（阶段 1.3）：移除某计划在 `stepIndex` 中的旧映射（按会话恢复时防残留） */
  private dropStepIndex(planId: string): void {
    for (const [stepId, plan] of this.stepIndex) {
      if (plan.id === planId) this.stepIndex.delete(stepId);
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
    // U-02（2026-10-17）：任何持久化都视为一次心跳（状态推进/重试/决策均会 save）。
    plan.lastHeartbeatAt = new Date().toISOString();
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
   * @param dependsOn 可选（1-1b，2026-09-03）：每步前置依赖的步骤序号（0-based 下标），
   *   按索引与 stepDescriptions 对齐；仅允许前置序号（防环），非法引用自愈忽略。
   *   由 createPlan 转换为 stepId 引用写入 PlanStep.dependsOn。
   * @returns 创建的 Plan 对象
   */
  createPlan(
    description: string,
    stepDescriptions: string[],
    sessionId: string,
    existingTaskIds?: string[],
    acceptanceCriteria?: string[],
    workspaceId?: string,
    dependsOn?: number[][]
  ): Plan {
    // U-02（2026-10-17）：同步加载完成后再创建，避免与加载过程交叉。
    this.ensureInitializedSync();

    const planId = `plan_${Date.now().toString(36)}_${randomIdSuffix(4)}`;

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
        // 13-P0-2：自由文本 → 结构化骨架（无有效条目 ⇒ undefined，保持旧路径）
        successCriteria: parseSuccessCriteria(acceptanceCriteria?.[i]),
      };
    });

    // 1-1b（2026-09-03）：按序号填充 dependsOn → stepId 引用。
    // 仅允许前置序号（idx < i）且引用存在，否则自愈忽略（防自环/后置/越界/编号漂移）。
    if (dependsOn && dependsOn.length > 0) {
      for (let i = 0; i < steps.length; i++) {
        const deps = dependsOn[i];
        if (!Array.isArray(deps) || deps.length === 0) continue;
        const ids: string[] = [];
        for (const d of deps) {
          if (Number.isInteger(d) && d >= 0 && d < i && steps[d]) {
            ids.push(steps[d].id);
          } else {
            logger.debug('dependsOn 非法引用已忽略（自愈）', {
              stepIndex: i,
              depIndex: d,
              stepCount: steps.length,
            });
          }
        }
        if (ids.length > 0) steps[i].dependsOn = ids;
      }
    }

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
    // P0 修复（2026-10-17）：**新建计划也必须建 stepId→Plan 索引**。
    // 此前只有磁盘重载路径（ensureInitializedSync）调用 buildStepIndex，导致
    // 进程内新建计划的 markStepRunning/Completed/Failed/Cancelled 与 review/decide
    // 全部静默 no-op（步骤状态、checkpoint、进度、审查、恢复全线失真）。
    this.buildStepIndex(plan);
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
      const { createSessionGateway } = await import('@modules/session');
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
  markStepCompleted(
    stepId: string,
    result?: string,
    meta?: { terminationReason?: string }
  ): PlanStep | undefined {
    const plan = this.getPlanByStepId(stepId);
    if (!plan) return undefined;

    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) return undefined;

    step.status = 'completed';
    step.result = result;
    // E1①（2026-09-05，方案甲）：终止原因透传落 PlanStep（供上层 retry/扩容决策）
    step.terminationReason = meta?.terminationReason;

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
  markStepFailed(
    stepId: string,
    error?: string,
    meta?: { partialOutput?: string }
  ): PlanStep | undefined {
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
    // P1-3（2026-09-06）：失败路线保留——终败前产出片段随失败落 plan step，不丢失
    if (meta?.partialOutput) step.partialOutput = meta.partialOutput;

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
