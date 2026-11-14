// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * planStartupResume —— **持久 DAG 的重启续跑**（D3 一期，2026-11-14）
 *
 * 规格：`.trae/specs/planner-resumable-dag.md`（取证：planner / 任务图持久化 / DAG 分批调度均已存在，
 * 唯一真实缺口 = **重启后没有任何入口去推进被中断的计划**）。
 *
 * 闭环（**不新建调度器、不新建存储、不改 `PlanDrivenLoop` 执行语义**）：
 *   ① 启动期扫 `TaskOrchestrator` 已从磁盘载入的计划，挑出**被重启打断**者；
 *   ② 为每个计划登记**一次**唤醒 `plan-startup:<planId>:<heartbeatMs>`（既有 selfWake）；
 *   ③ 到点由既有执行器注入"计划续接"指令并续跑会话（与 D2+ 目标续接同一路径）；
 *   ④ 触发时二次校验：计划仍 running、仍有未终态步骤、心跳**未变**（期间推进 ⇒ 作废）。
 *
 * 有界性：
 * - 每进程每计划最多登记一次（进程内集合）；
 * - 单次扫描上限 {@link PLAN_RESUME_MAX_PLANS}（按心跳倒序，落后者留到下次启动）；
 * - 心跳**必须已过期**（>10 分钟）⇒ 不与在跑执行打架；
 * - 心跳**必须在新鲜窗口内**（≤24h）⇒ 不复活早已放弃的历史计划。
 *
 * 判定与 IO 分离（R06-006 GR03）：选择器 / 指令渲染 / taskId 编解码均为**纯函数**，IO 经参数注入。
 */

import { feature } from '@openliri/kernel';
import { getLogger } from '@openliri/infra/monitoring';
import { getCg3SelfWakeService } from '@modules/tasks/Cg3Bootstrap';
import { PLAN_STATUS_RUNNING, type Plan } from '../TaskOrchestrator';
import {
  buildPlanImpactPreview,
  hasRecordedImpact,
  renderPlanImpactPreview,
  type PlanImpactOptions,
} from './planImpactPreview';
import { isNonTerminalStep } from './planStepStatus';

const logger = getLogger('tasks:plan:startupResume');

/** `taskId` 前缀（与目标续接 `goal-startup:` 区分） */
export const PLAN_STARTUP_RESUME_TASK_PREFIX = 'plan-startup:';

/** 登记后的等待秒数（与 D2+ 同口径：只等启动收尾） */
export const PLAN_RESUME_DELAY_SEC = 30;

/** 单次启动最多登记的计划数 */
export const PLAN_RESUME_MAX_PLANS = 5;

/**
 * 新鲜窗口（小时）：只有**最近 24h 内仍被推进过**的计划才算"被本次重启打断的工作"；
 * 更早的视为用户已放弃（不臆造"该继续"）。与 D2+ 目标续接同口径。
 */
export const PLAN_RESUME_FRESH_WINDOW_HOURS = 24;

/**
 * 心跳过期阈值（分钟）：与 `TaskOrchestrator` 的 ghost 宽限默认值同口径（10 分钟）。
 * 心跳仍新鲜 ⇒ 可能正在执行（其它进程/线程）⇒ 绝不登记续跑。
 */
export const PLAN_RESUME_STALE_AFTER_MINUTES = 10;

/** 计划心跳（ms；缺失/非法 ⇒ `NaN`，由调用方按"不可判"处理） */
export function planHeartbeatMs(plan: {
  lastHeartbeatAt?: string;
  createdAt: string;
}): number {
  return Date.parse(plan.lastHeartbeatAt ?? plan.createdAt);
}

export interface PlanResumeOptions {
  /** 新鲜窗口（小时；测试注入） */
  freshWindowHours?: number;
  /** 心跳过期阈值（分钟；测试注入） */
  staleAfterMinutes?: number;
}

/**
 * 是否为**可续跑**的计划（纯函数）。
 *
 * 四道闸门：有会话归属 / 状态 running / 仍有未终态步骤 / 心跳落在
 * `(staleAfter, freshWindow]` 区间。
 */
export function isPlanResumable(
  plan: Pick<
    Plan,
    'sessionId' | 'status' | 'steps' | 'createdAt' | 'lastHeartbeatAt'
  >,
  now: number,
  options: PlanResumeOptions = {}
): boolean {
  const freshWindowHours =
    options.freshWindowHours ?? PLAN_RESUME_FRESH_WINDOW_HOURS;
  const staleAfterMinutes =
    options.staleAfterMinutes ?? PLAN_RESUME_STALE_AFTER_MINUTES;

  if (!plan.sessionId) return false;
  if (plan.status !== PLAN_STATUS_RUNNING) return false;
  if (!plan.steps.some(isNonTerminalStep)) return false;

  const heartbeat = planHeartbeatMs(plan);
  if (!Number.isFinite(heartbeat)) return false;

  const ageMs = now - heartbeat;
  // 心跳新鲜 ⇒ 可能正在跑（不抢）
  if (ageMs <= staleAfterMinutes * 60_000) return false;
  // 超窗 ⇒ 用户已放弃（不复活）
  if (ageMs > freshWindowHours * 60 * 60_000) return false;
  return true;
}

/**
 * 选出本次启动要续跑的计划（纯函数）：按心跳**倒序**（最近被打断的优先），最多 `maxPlans` 条。
 */
export function selectResumablePlans(
  plans: readonly Plan[],
  params: { now: number; maxPlans?: number } & PlanResumeOptions
): Plan[] {
  const maxPlans = params.maxPlans ?? PLAN_RESUME_MAX_PLANS;
  return plans
    .filter((plan) => isPlanResumable(plan, params.now, params))
    .sort((a, b) => planHeartbeatMs(b) - planHeartbeatMs(a))
    .slice(0, maxPlans);
}

/** 构造 `taskId`：`plan-startup:<planId>:<heartbeatMs>`（心跳参与编码 ⇒ 可判陈旧） */
export function buildPlanResumeTaskId(
  planId: string,
  heartbeatMs: number
): string {
  return `${PLAN_STARTUP_RESUME_TASK_PREFIX}${planId}:${heartbeatMs}`;
}

/** 解析 `taskId`；非本前缀 / 缺心跳 ⇒ `null`（按**最后一个** `:` 切分，planId 可含 `:`） */
export function parsePlanResumeTaskId(
  taskId: string
): { planId: string; heartbeatMs: number } | null {
  if (!taskId.startsWith(PLAN_STARTUP_RESUME_TASK_PREFIX)) return null;
  const rest = taskId.slice(PLAN_STARTUP_RESUME_TASK_PREFIX.length);
  const sep = rest.lastIndexOf(':');
  if (sep <= 0) return null;
  const heartbeatMs = Number(rest.slice(sep + 1));
  if (!Number.isFinite(heartbeatMs) || heartbeatMs <= 0) return null;
  return { planId: rest.slice(0, sep), heartbeatMs };
}

/** 是否为"计划重启续跑"唤醒 */
export function isStartupPlanResumeTask(taskId: string): boolean {
  return taskId.startsWith(PLAN_STARTUP_RESUME_TASK_PREFIX);
}

/** 非终态步骤在计划中的序号（1-based，供指令中引用） */
function stepNumber(plan: Plan, stepId: string): number {
  const index = plan.steps.findIndex((s) => s.id === stepId);
  return index >= 0 ? index + 1 : 0;
}

/**
 * 渲染"计划续接"指令（**纯函数**：同一计划 + 同一副作用声明 ⇒ 逐字相同）。
 *
 * 只写计划事实（描述 / 进度 / 剩余步骤 / 依赖），不臆造"上次做到哪一步"。
 * D7（2026-11-14）：有历史台账时追加「上次执行影响」段落（产物 / 副作用类别 / 拦截计数），
 * 让续跑的模型知道"这些副作用上次已经发生过"，避免重复外部动作。
 *
 * @param impactOptions 工具副作用解析（**注入**，避免 tasks→tools 循环依赖）
 */
export function buildPlanResumeInstruction(
  plan: Plan,
  impactOptions?: PlanImpactOptions
): string {
  const remaining = plan.steps.filter(isNonTerminalStep);
  const done = plan.steps.length - remaining.length;
  const lines: string[] = [
    `[计划续接] 一项未完成的执行计划在进程重启时被打断，请接着做，**不要新建计划**。`,
    '',
    `- 计划：${plan.description}`,
    `- planId：${plan.id}`,
    `- 进度：${done}/${plan.steps.length} 步已完成`,
    '',
    '未完成步骤：',
  ];
  remaining.forEach((step, i) => {
    const deps = (step.dependsOn ?? [])
      .map((id) => stepNumber(plan, id))
      .filter((n) => n > 0)
      .map((n) => `步骤 ${n}`);
    const suffix = deps.length > 0 ? `（依赖：${deps.join('、')}）` : '';
    lines.push(`${i + 1}. ${step.description}${suffix}`);
  });
  lines.push(
    '',
    '要求：',
    '1. 从上面第一个未完成步骤继续；**已完成步骤不要重做**；',
    '2. 动手前先核对当前代码/文件状态，若与计划已不符，以实际状态为准并说明偏离；',
    '3. 全部完成后简要汇报产出与偏离点。'
  );

  // D7：有历史台账才追加影响段落（无台账不塞空段落）
  const preview = buildPlanImpactPreview(plan, impactOptions);
  if (hasRecordedImpact(preview)) {
    lines.push('', renderPlanImpactPreview(preview));
  }
  return lines.join('\n');
}

// ─── 调度面（只声明真正用到的方法；生产 = CG3 selfWake）───────────────

export interface PlanResumeScheduler {
  sleepFor(
    sessionId: string,
    taskId: string,
    seconds: number
  ): Promise<unknown>;
  getPendingBySession(
    sessionId: string
  ): Promise<ReadonlyArray<{ taskId?: string; status?: string }>>;
}

/** 计划事实源最小面（生产 `TaskOrchestrator` 单例；测试注入） */
export interface PlanResumeSource {
  initialize(): Promise<void>;
  getAllPlans(): Plan[];
  getPlan(planId: string): Plan | undefined;
  resetStaleRunningSteps(planId: string, now?: number): number;
}

/** 已登记的计划（进程内；同一进程重复扫描不重复登记） */
const enqueuedPlans = new Set<string>();

/** 仅测试使用：清空已登记集合 */
export function resetStartupPlanResumesForTest(): void {
  enqueuedPlans.clear();
}

export interface PlanResumeReport {
  scanned: number;
  enqueued: number;
  skipped: number;
  deferred: number;
}

/**
 * 启动期扫描：为被重启打断的计划各登记**一次**续跑唤醒（幂等）。
 *
 * 开关 `PLAN_STARTUP_RESUME` 关闭 ⇒ 直接返回零报告（不扫描、不登记）。
 */
export async function enqueueStartupPlanResumes(
  params: {
    scheduler?: PlanResumeScheduler | null;
    source?: PlanResumeSource;
    now?: number;
  } = {}
): Promise<PlanResumeReport> {
  const report: PlanResumeReport = {
    scanned: 0,
    enqueued: 0,
    skipped: 0,
    deferred: 0,
  };
  if (!feature('PLAN_STARTUP_RESUME')) return report;

  const scheduler =
    params.scheduler !== undefined
      ? params.scheduler
      : (getCg3SelfWakeService() as PlanResumeScheduler | null);
  if (!scheduler) return report;

  const source = params.source ?? (await loadDefaultPlanSource());
  if (!source) return report;
  await source.initialize();

  const now = params.now ?? Date.now();
  const plans = source.getAllPlans();
  report.scanned = plans.length;

  const candidates = selectResumablePlans(plans, { now });
  report.skipped = plans.length - candidates.length;

  for (const plan of candidates) {
    if (enqueuedPlans.has(plan.id)) {
      report.skipped += 1;
      continue;
    }
    const pending = await scheduler.getPendingBySession(plan.sessionId);
    const alreadyScheduled = pending.some(
      (entry) =>
        typeof entry.taskId === 'string' &&
        entry.taskId.startsWith(`${PLAN_STARTUP_RESUME_TASK_PREFIX}${plan.id}:`)
    );
    if (alreadyScheduled) {
      report.skipped += 1;
      continue;
    }
    await scheduler.sleepFor(
      plan.sessionId,
      buildPlanResumeTaskId(plan.id, planHeartbeatMs(plan)),
      PLAN_RESUME_DELAY_SEC
    );
    enqueuedPlans.add(plan.id);
    report.enqueued += 1;
  }
  report.deferred = Math.max(0, candidates.length - PLAN_RESUME_MAX_PLANS);
  return report;
}

export interface PlanResumeTarget {
  planId: string;
  sessionId: string;
  /** 计划描述（系统级续跑时作为 PDL 的计划源） */
  description: string;
  instruction: string;
  /** 本次复位的崩溃残留 `running` 步骤数（0 = 无残留） */
  resetSteps: number;
}

/**
 * 触发时二次校验：**仍可续跑**才返回目标（否则 `null` ⇒ 装配处 no-op）。
 *
 * 三道闸门：① 开关未关（kill switch）；② 计划仍存在且仍可续跑；③ 心跳与登记时**一致**
 * （期间任何持久化 = 已有推进 ⇒ 该唤醒陈旧）。
 */
export async function resolveStartupPlanResume(params: {
  taskId: string;
  source?: PlanResumeSource;
  now?: number;
  /** D7：工具副作用解析（注入；缺省 ⇒ 影响段落里该部分计为 unknown） */
  resolveEffect?: PlanImpactOptions['resolveEffect'];
}): Promise<PlanResumeTarget | null> {
  if (!feature('PLAN_STARTUP_RESUME')) return null;
  const parsed = parsePlanResumeTaskId(params.taskId);
  if (!parsed) return null;

  const source = params.source ?? (await loadDefaultPlanSource());
  if (!source) return null;
  await source.initialize();
  const plan = source.getPlan(parsed.planId);
  if (!plan) return null;
  if (planHeartbeatMs(plan) !== parsed.heartbeatMs) return null;
  if (!isPlanResumable(plan, params.now ?? Date.now())) return null;

  // 校验通过后再复位（复位会刷新心跳 ⇒ 重复触发时自然作废，避免二次续跑）
  const resetSteps = source.resetStaleRunningSteps(
    plan.id,
    params.now ?? Date.now()
  );
  const latest = source.getPlan(plan.id) ?? plan;
  return {
    planId: latest.id,
    sessionId: latest.sessionId,
    description: latest.description,
    instruction: buildPlanResumeInstruction(
      latest,
      params.resolveEffect ? { resolveEffect: params.resolveEffect } : undefined
    ),
    resetSteps,
  };
}

/**
 * 懒加载默认事实源（`TaskOrchestrator` 单例）。
 *
 * 延迟到调用点加载：`TaskOrchestrator` 体量大且会拉起任务注册表，启动期未开启本能力时
 * 不应因本模块而多加载一份（与 `main.ts` 的 `wrapInit` 动态 import 同口径）。
 */
async function loadDefaultPlanSource(): Promise<PlanResumeSource | null> {
  try {
    const mod = await import('../TaskOrchestrator');
    return mod.taskOrchestrator;
  } catch (err) {
    // @ignore-catch — 事实源不可用 ⇒ 不续跑（留痕，不阻断启动）
    logger.warn('计划续跑：加载 TaskOrchestrator 失败', {
      error: String(err),
    });
    return null;
  }
}
