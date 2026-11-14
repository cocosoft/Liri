// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * goalStartupResume —— 重启后**跨会话续接**（D2+，2026-11-14）
 *
 * 现状缺口：`goalIdleContinuation` 只在**批次结算落到 `blocked`** 时登记唤醒 ⇒
 * 进程在目标 `active` 期间被杀、或唤醒文件丢失/被 GC 时，未达终态的目标
 * **再也不会有任何调度去推进它**（用户不发消息就永久停在那里）。
 *
 * 本模块只做一件事：启动期（恢复编排完成之后）扫一遍**未终结**目标，为每个目标
 * 登记**一次**续跑唤醒。续跑本身仍由既有执行器完成 —— `recovery.ts` 的 selfWake
 * handler → `takeIdleContinuationInstruction`（`continue_goal` 模板 + `goal/injected` 事件）
 * → `resumeSessionInternally`。**不新建调度器、不新建执行器、不新建事件类型**。
 *
 * 有界性（关键）：
 * - 每次启动每目标最多登记一次（进程内集合 + `taskId` 编码 `updatedAt`）；
 * - 单次扫描上限 {@link STARTUP_RESUME_MAX_GOALS}（防历史目标堆积刷屏）；
 * - 会话已有该目标的 `pending` 唤醒（idle 续接 / 上次启动登记的）⇒ 跳过；
 * - 触发时校验"目标仍非终态且 `updatedAt` 未变"——期间已有任何推进 ⇒ 该唤醒作废
 *   （不重复注入，对齐 `resolveIdleContinuation` 的陈旧唤醒闸门）。
 *
 * 身份口径（如实）：启动期无请求作用域 ⇒ 只扫**本地身份**（`local:local`）的目标；
 * 租户用户的目标在其租户库，重启后由该用户下一次会话/结算照常推进。
 */

import { feature } from '@openliri/kernel';
import { getCg3SelfWakeService } from '@modules/tasks/Cg3Bootstrap';
import {
  getTaskGoalStore,
  isTerminalGoalStatus,
  type TaskGoal,
  type TaskGoalUpdateReason,
} from './TaskGoalStore';
import { IDLE_CONTINUE_TASK_PREFIX } from './goalIdleContinuation';

/** `taskId` 前缀（与 idle 续接区分：装配处据此走"重启续接"闸门） */
export const STARTUP_RESUME_TASK_PREFIX = 'goal-startup:';

/**
 * 登记后的等待秒数。
 *
 * 取值：**30s** —— 只用于"等启动收尾（恢复编排 / 会话预热）"，同时 < `SelfWakeService`
 * 默认 tickInterval(300s) ⇒ 走精确 `setTimeout` 路径，不依赖 cron tick 恰好转起来。
 */
export const STARTUP_RESUME_DELAY_SEC = 30;

/** 单次启动最多登记的续接数（其余留到下次启动；只记日志，不静默丢弃） */
export const STARTUP_RESUME_MAX_GOALS = 5;

/**
 * "最近仍在推进"的时间窗（小时）。
 *
 * 为什么需要：真机库实测**128 个非终态目标**积压（多为早已放弃的历史目标）——
 * 若不加时间窗，每次启动都会把这批僵尸目标当"待续接"重排，既刷屏又白白消耗 token。
 * 口径：只有 `updatedAt` 落在窗口内的目标才算"被本次重启打断的工作"；更早的视为
 * 用户已放弃（不臆造"该继续"）。
 */
export const STARTUP_RESUME_FRESH_WINDOW_HOURS = 24;

/**
 * 调度器最小可用面（供注入/测试；生产用 `getCg3SelfWakeService()`）。
 * 只声明本模块真正用到的两个方法 ⇒ 不耦合 `SelfWakeService` 全量 API。
 */
export interface StartupResumeScheduler {
  sleepFor(
    sessionId: string,
    taskId: string,
    seconds: number
  ): Promise<unknown>;
  getPendingBySession(
    sessionId: string
  ): Promise<ReadonlyArray<{ taskId?: string; status?: string }>>;
}

/** 目标事实源最小面（生产 `TaskGoalStore`；测试可注入） */
export interface StartupGoalSource {
  listActive(): Promise<TaskGoal[]>;
  get(id: string): Promise<TaskGoal | null>;
}

/** 是否为"重启续接"唤醒 */
export function isStartupGoalResumeTask(taskId: string): boolean {
  return taskId.startsWith(STARTUP_RESUME_TASK_PREFIX);
}

/**
 * 构造 `taskId`：`goal-startup:<goalId>:<updatedAt>`。
 *
 * `updatedAt` 参与编码 ⇒ 触发时可判"期间是否已有推进"（陈旧唤醒作废）。
 * 解析按**最后一个** `:` 切分（`goalId` 由用户经 `POST /v1/goals` 传入，可能含 `:`）。
 */
function buildStartupResumeTaskId(goalId: string, updatedAt: number): string {
  return `${STARTUP_RESUME_TASK_PREFIX}${goalId}:${updatedAt}`;
}

/** 解析 `taskId`；非法（非本前缀 / 缺时间戳）⇒ `null` */
export function parseStartupResumeTaskId(
  taskId: string
): { goalId: string; updatedAt: number } | null {
  if (!isStartupGoalResumeTask(taskId)) return null;
  const rest = taskId.slice(STARTUP_RESUME_TASK_PREFIX.length);
  const sep = rest.lastIndexOf(':');
  if (sep <= 0) return null;
  const updatedAt = Number(rest.slice(sep + 1));
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return null;
  return { goalId: rest.slice(0, sep), updatedAt };
}

/** 已登记的目标（进程内；同一进程内重复调用扫描不重复登记） */
const enqueuedGoals = new Set<string>();

/** 仅测试使用：清空已登记集合 */
export function resetStartupGoalResumesForTest(): void {
  enqueuedGoals.clear();
}

export interface StartupResumeReport {
  /** 扫描到的未终结目标数（含无会话归属 / 过窗者） */
  scanned: number;
  /** 本次登记的唤醒数 */
  enqueued: number;
  /** 跳过数（无会话归属 / 超出新鲜窗口 / 已有 pending 唤醒 / 已登记过） */
  skipped: number;
  /** 因单次上限未处理的目标数（按最近更新倒序，落后者留到下次启动） */
  deferred: number;
}

/**
 * 启动期扫描：为**最近仍被推进过**的未终结目标登记一次续跑唤醒（幂等）。
 *
 * 候选顺序：`updatedAt` **倒序**（最近推进过的优先）—— 这样单次上限不会永远
 * 卡在最早的目标上（真机 128 个积压目标实测过的饿死风险）。
 *
 * @param params.scheduler  调度器（缺省取 CG3 单例；为 `null` ⇒ 未启用自主闭环，零行为）
 * @param params.store      目标事实源（缺省全局单例）
 * @param params.now        当前时刻（缺省 `Date.now()`；测试注入）
 */
export async function enqueueStartupGoalResumes(
  params: {
    scheduler?: StartupResumeScheduler | null;
    store?: StartupGoalSource;
    now?: number;
  } = {}
): Promise<StartupResumeReport> {
  const report: StartupResumeReport = {
    scanned: 0,
    enqueued: 0,
    skipped: 0,
    deferred: 0,
  };
  // 默认关（`FEATURE_GOAL_STARTUP_RESUME=false`）：真机库有大量历史非终态目标，
  // 默认自动续跑会在每次启动消耗模型调用 ⇒ 必须显式 opt-in（见 featureFlags 注释）。
  if (!feature('GOAL_STARTUP_RESUME')) return report;
  const scheduler =
    params.scheduler !== undefined
      ? params.scheduler
      : (getCg3SelfWakeService() as StartupResumeScheduler | null);
  if (!scheduler) return report;

  const now = params.now ?? Date.now();
  const freshCutoff = now - STARTUP_RESUME_FRESH_WINDOW_HOURS * 60 * 60 * 1000;
  const store = params.store ?? getTaskGoalStore();
  const goals = (await store.listActive()).filter(
    (goal) => !isTerminalGoalStatus(goal.status)
  );
  report.scanned = goals.length;

  const candidates = goals
    .filter((goal) => !!goal.sessionId && goal.updatedAt >= freshCutoff)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  report.skipped = goals.length - candidates.length;

  for (const goal of candidates.slice(0, STARTUP_RESUME_MAX_GOALS)) {
    const sessionId = goal.sessionId as string;
    if (enqueuedGoals.has(goal.id)) {
      report.skipped += 1;
      continue;
    }
    const pending = await scheduler.getPendingBySession(sessionId);
    const alreadyScheduled = pending.some(
      (entry) =>
        typeof entry.taskId === 'string' &&
        (entry.taskId.startsWith(`${IDLE_CONTINUE_TASK_PREFIX}${goal.id}:`) ||
          entry.taskId.startsWith(`${STARTUP_RESUME_TASK_PREFIX}${goal.id}:`))
    );
    if (alreadyScheduled) {
      report.skipped += 1;
      continue;
    }
    await scheduler.sleepFor(
      sessionId,
      buildStartupResumeTaskId(goal.id, goal.updatedAt),
      STARTUP_RESUME_DELAY_SEC
    );
    enqueuedGoals.add(goal.id);
    report.enqueued += 1;
  }
  report.deferred = Math.max(0, candidates.length - STARTUP_RESUME_MAX_GOALS);

  return report;
}

export interface StartupResumeTarget {
  goalId: string;
  sessionId: string;
  objective: string;
  streak: number;
  updatedReason?: TaskGoalUpdateReason;
}

/**
 * 触发时校验：**仍可续接**才返回目标（否则 `null` ⇒ 装配处 no-op）。
 *
 * 三道闸门：
 * 1. `taskId` 可解析；
 * 2. 目标仍存在、**非终态**且有会话归属（终态续了也没意义）；
 * 3. `updatedAt` 与登记时**一致**（期间任何写入 = 已有推进/变更 ⇒ 该唤醒陈旧）。
 */
export async function resolveStartupGoalResume(params: {
  taskId: string;
  store?: StartupGoalSource;
}): Promise<StartupResumeTarget | null> {
  // 开关关闭 ⇒ 即使有历史遗留的 pending 唤醒也不再续跑（kill switch 语义）
  if (!feature('GOAL_STARTUP_RESUME')) return null;
  const parsed = parseStartupResumeTaskId(params.taskId);
  if (!parsed) return null;
  const store = params.store ?? getTaskGoalStore();
  const goal = await store.get(parsed.goalId);
  if (!goal || !goal.sessionId) return null;
  if (isTerminalGoalStatus(goal.status)) return null;
  if (goal.updatedAt !== parsed.updatedAt) return null;
  return {
    goalId: goal.id,
    sessionId: goal.sessionId,
    objective: goal.objective,
    streak: goal.noProgressStreak,
    ...(goal.updatedReason ? { updatedReason: goal.updatedReason } : {}),
  };
}
