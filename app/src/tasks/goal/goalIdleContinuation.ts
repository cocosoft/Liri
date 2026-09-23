// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * goalIdleContinuation —— **空闲触发续接**（M-7 的 `continue_if_idle` 等价物，2026-09-22）
 *
 * 为什么需要：目标落到 `blocked`（未达成但**非终态**）后，**当前没有任何调度会再推进它** ——
 * 用户不发新消息，目标就永久停在那里（"为何停下"有了登记，但"该继续"没人做）。
 * codex 的对位能力是 `continue_if_idle`：会话空闲时自动续跑未完成的线程目标。
 *
 * 实现口径（**全部复用既有基建，不新建调度器**）：
 * - **调度**复用 `SelfWakeService.sleepFor`（`WakeStore` 持久化 ⇒ 重启后由 cron tick 补发；
 *   延迟 < tickInterval ⇒ 走精确 `setTimeout`）；
 * - **续跑**复用 `ChatManager` 已装配的 selfWake 执行器 → `_resumeSessionInternally`
 *   → 消费 `streamMessage`（会话级 mutex 已串行化 ⇒ 不会与在途 turn 交错）；
 * - **文案**复用 `goalTemplates`（M-7 单一来源）。
 *
 * **有界性（关键）**：只有 `blocked` 结算才登记，且**每次结算 ≤1 次**；配合停止条件
 * （连续 3 次 `blocked` ⇒ 终态 `failed`，见 `goalRunBinding.NO_PROGRESS_STOP_THRESHOLD`）
 * ⇒ 单目标续接次数**有上界**，不会无限自动续跑。
 *
 * **防重复 / 防陈旧**：`taskId` 编码 `(goalId, streak)`；触发时校验"目标仍 `blocked`
 * 且 `streak` 未变"，否则 no-op（期间若已有新结算，它会自行登记 ⇒ 旧的作废）。
 *
 * **idle 闸门不在此模块**：真正的"会话是否空闲"要问 `ChatManager`
 * （它持有 `ActiveSubagentRunProbe` / 引擎台账）⇒ 本模块只负责"该续接谁"，
 * "此刻能不能续"由装配处判断。
 */

import { getCg3SelfWakeService } from '@modules/tasks/Cg3Bootstrap';
import { getTaskGoalStore, type TaskGoalStore } from './TaskGoalStore';

/** `taskId` 前缀（生产唯一识别"这是目标空闲续接"的依据） */
export const IDLE_CONTINUE_TASK_PREFIX = 'goal-continue:';

/**
 * 登记后的等待秒数（给用户留出介入窗口；也避开"结算发生在 turn 内"的时机）。
 *
 * 取值：**120s** —— 短于 `SelfWakeService` 默认 `tickIntervalMs`(300s) ⇒ 走精确
 * `setTimeout` 路径（不依赖 cron tick 在跑）；足够用户主动接话把目标推进/推翻。
 */
export const IDLE_CONTINUE_DELAY_SEC = 120;

/**
 * 调度器最小可用面（供注入/测试；生产用 `getCg3SelfWakeService()`）。
 * 只声明本模块真正用到的 `sleepFor` ⇒ 不耦合 `SelfWakeService` 全量 API。
 */
export interface IdleContinuationScheduler {
  sleepFor(
    sessionId: string,
    taskId: string,
    seconds: number
  ): Promise<unknown>;
}

/** 是否为目标空闲续接的唤醒（装配处据此分流到 goal 专用提示词） */
export function isIdleContinuationTask(taskId: string): boolean {
  return taskId.startsWith(IDLE_CONTINUE_TASK_PREFIX);
}

/**
 * 构造 `taskId`：`goal-continue:<goalId>:<streak>`。
 *
 * `streak` 参与编码 ⇒ 同目标不同结算的唤醒彼此可区分（陈旧者可被识别并作废）。
 * 解析时按**最后一个** `:` 切分（`goalId` 由用户经 `POST /v1/goals` 传入，可能含 `:`）。
 */
function buildIdleContinueTaskId(goalId: string, streak: number): string {
  return `${IDLE_CONTINUE_TASK_PREFIX}${goalId}:${streak}`;
}

/** 解析 `taskId`；非法（非本前缀 / 缺 streak）⇒ `null` */
export function parseIdleContinueTaskId(
  taskId: string
): { goalId: string; streak: number } | null {
  if (!isIdleContinuationTask(taskId)) return null;
  const rest = taskId.slice(IDLE_CONTINUE_TASK_PREFIX.length);
  const sep = rest.lastIndexOf(':');
  if (sep <= 0) return null;
  const streak = Number(rest.slice(sep + 1));
  if (!Number.isInteger(streak) || streak < 0) return null;
  return { goalId: rest.slice(0, sep), streak };
}

/**
 * **仅测试使用**：替换默认调度器（`getCg3SelfWakeService()`）。
 *
 * 动机：装配侧（`AgentTool`）不注入调度器 ⇒ 若没有本缝，就**无法验证"blocked 结算真的
 * 登记了续接"**（生产默认取 CG3 单例，测试环境为 `null` ⇒ 恒返回 false，接线错误会被掩盖）。
 * 与 `setTaskGoalStoreForTest` / `resetAgentRunLedger()` 同法。
 *
 * 传 `null` ⇒ 显式模拟"未启用 CG3"；传 `undefined` ⇒ 恢复默认（取 CG3 单例）。
 */
let schedulerOverrideForTest: IdleContinuationScheduler | null | undefined;

export function setIdleContinuationSchedulerForTest(
  scheduler: IdleContinuationScheduler | null | undefined
): void {
  schedulerOverrideForTest = scheduler;
}

/**
 * 登记一次空闲续接。
 *
 * **只在目标落到 `blocked` 时调用**（`settleGoalForRun` 的 `status === 'blocked'` 分支），
 * 且应传**该次结算后的** `noProgressStreak`（`resolveIdleContinuation` 靠它判陈旧）。
 *
 * @returns 是否真的登记（无会话归属 / 未启动 CG3 ⇒ `false`，**不抛**）
 */
export async function enqueueIdleContinuation(params: {
  sessionId?: string;
  goalId: string;
  streak: number;
  /** 可注入调度器（测试用）；显式传 `null` ⇒ 视为"无调度器" */
  scheduler?: IdleContinuationScheduler | null;
}): Promise<boolean> {
  const { sessionId, goalId, streak } = params;
  if (!sessionId) return false;
  const scheduler =
    params.scheduler !== undefined
      ? params.scheduler
      : schedulerOverrideForTest !== undefined
        ? schedulerOverrideForTest
        : getCg3SelfWakeService();
  // 未启动 CG3（CLI / 单测 / 未启用自主闭环）⇒ 静默降级为"无空闲续接"，
  // 不影响 `blocked` 状态本身（状态已由 `goalRunBinding` 落定）。
  if (!scheduler) return false;
  await scheduler.sleepFor(
    sessionId,
    buildIdleContinueTaskId(goalId, streak),
    IDLE_CONTINUE_DELAY_SEC
  );
  return true;
}

export interface IdleContinuationTarget {
  goalId: string;
  objective: string;
  streak: number;
}

/**
 * 触发时校验：**仍然可续接**才返回目标（否则 `null` ⇒ 装配处 no-op）。
 *
 * 三道闸门（缺一都会造成重复/陈旧注入）：
 * 1. `taskId` 可解析（前缀 + `(goalId, streak)`）；
 * 2. 目标**仍为 `blocked`** —— 已完成 / 触顶（`budget_limited`）/ 判停（`failed`）/
 *    取消 ⇒ 都不该再续（终态不可改写，续了也没意义）；
 * 3. `noProgressStreak` 与登记时**一致** —— 期间又有批次结算 ⇒ 该唤醒已陈旧
 *    （新结算会自行登记，旧的不应重复注入）。
 */
export async function resolveIdleContinuation(params: {
  taskId: string;
  store?: TaskGoalStore;
}): Promise<IdleContinuationTarget | null> {
  const parsed = parseIdleContinueTaskId(params.taskId);
  if (!parsed) return null;
  const store = params.store ?? getTaskGoalStore();
  const goal = await store.get(parsed.goalId);
  if (!goal) return null;
  if (goal.status !== 'blocked') return null;
  if (goal.noProgressStreak !== parsed.streak) return null;
  return {
    goalId: goal.id,
    objective: goal.objective,
    streak: goal.noProgressStreak,
  };
}
