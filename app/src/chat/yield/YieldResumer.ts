// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * YieldResumer — 恢复通路：子代理全部结算后让等待中的父会话继续（阶段 A / A1-e）
 *
 * 设计：`.trae/documents/阶段A-恢复通路设计Spec.md` §3.3
 *   ① 结算信号 → `YieldRegistry.shouldResume`（含两条例外：结算早于登记即忽略、turn 已取代即作废）
 *   ② 判定通过 → 调用**装配处注入的** resume handler 开启父会话新 turn
 *      （handler 内部消费 `ChatManager.streamMessage`，不依赖 HTTP 请求）
 *   ③ 收敛：成功 `resolve` / 失败 `abandon`（避免永久等待）
 *
 * 依赖以函数注入，本模块**不直接 import `ChatManager`**，避免循环依赖。
 */

import { getLogger } from '@modules/monitoring';
import { withPhase } from '@modules/diagnostics';
import { getYieldRegistry, YIELD_STATUS_RESUMED } from '../../session/yield';
import {
  yieldSettlementListeners,
  YIELD_SETTLEMENT_RESTORED_REASON,
  type YieldSettlementListener,
  type YieldSettlementSignal,
} from './YieldSettlementBridge';
import { getSettlementOutbox, type SettlementOutbox } from './SettlementOutbox';
import { recordYieldRecovery } from './YieldRecoveryAudit';

const logger = getLogger('chat:yield:resumer');

/** 恢复执行器：开启父会话新 turn（由装配处提供，内部消费 streamMessage） */
export type YieldResumeHandler = (params: {
  sessionId: string;
  /** 该 yield 所属 turn（登记时补全；仅用于日志与审计） */
  turn: number;
  /** 该轮 sessions_yield 的 toolCallId */
  toolCallId: string;
  /** 恢复触发原因（写入注入内容的元数据） */
  reason: string;
}) => Promise<{ ok: boolean; error?: string }>;

/** 恢复器依赖（装配处注入，避免直接依赖 chat/subagent 具体实现） */
export interface YieldResumerDeps {
  /**
   * 该会话是否仍有活跃子代理 run（true ⇒ 继续等待）。
   *
   * B1/O1-2：按**会话**取值 —— 全局计数会把其他会话的在途子代理算成本会话的，
   * 使本会话的 yield 等待被永久阻塞（`YieldRegistry.shouldResume` 的判据②）。
   */
  hasActiveRuns: (sessionId: string) => boolean;
  /** 取该会话当前最新 turn 编号（用于"登记是否已被后续轮次取代"判定） */
  latestTurn: (sessionId: string) => Promise<number> | number;
}

let resumeHandler: YieldResumeHandler | null = null;

/** 注册恢复执行器（装配处调用；传 null 可卸载） */
export function setYieldResumeHandler(
  handler: YieldResumeHandler | null
): void {
  resumeHandler = handler;
}

/** 供测试读取当前是否已装配 */
export function hasYieldResumeHandler(): boolean {
  return resumeHandler !== null;
}

/**
 * 处理单个结算信号。
 * 返回是否真的触发了恢复（供测试与观测使用）。
 */
export async function handleYieldSettlement(
  signal: YieldSettlementSignal,
  deps: YieldResumerDeps
): Promise<boolean> {
  const registry = getYieldRegistry();
  const entry = registry.get(signal.sessionId);
  if (!entry) {
    // N-36 附注（2026-09-20）：原为静默 return —— 补 warn，区分"结算到了但该会话无等待登记"
    // 与"登记存在但判定不可恢复"（否则现场只剩"结算后什么都没发生"）
    logger.warn('yield 结算到达但该会话无等待登记', {
      sessionId: signal.sessionId,
      endedAt: signal.endedAt,
    });
    return false; // 该会话当前无 yield 等待
  }

  const latestTurn = await deps.latestTurn(signal.sessionId);
  const canResume = registry.shouldResume({
    sessionId: signal.sessionId,
    latestTurn,
    hasActiveRuns: deps.hasActiveRuns(signal.sessionId),
    endedAt: signal.endedAt,
  });
  if (!canResume) {
    logger.warn('yield 结算判定为不可恢复（登记保留）', {
      sessionId: signal.sessionId,
      entryTurn: entry.turn,
      latestTurn,
      endedAt: signal.endedAt,
    });
    return false;
  }

  // 取局部快照：模块级 `resumeHandler` 是可变绑定，进入闭包后 TS 的收窄会失效
  // （B4-2 把调用包进 `withPhase` 的箭头函数后暴露）⇒ 显式捕获，语义与判定顺序不变。
  const handler = resumeHandler;
  if (!handler) {
    // 未装配：保持等待（不 resolve、不 abandon）——装配缺失应可观测而非静默
    logger.warn('yield 恢复未装配：等待保留', {
      sessionId: signal.sessionId,
      turn: entry.turn,
    });
    return false;
  }

  // B1-1（P0-1 / I1）：**同步 CAS 认领**，且必须在**任何 await 之前**完成。
  // 判定链（get → shouldResume）本身跨越了 `await deps.latestTurn`，两路并发结算会各自
  // 通过判定 ⇒ 修复前 `resumeHandler` 被调用两次（父会话恢复两次、起两个并发 turn）。
  // 此处认领是唯一的互斥闸门：`claim()` 无 await ⇒ 只有一路成功。
  // 注：认领放在"未装配 handler"检查**之后** —— 否则未装配时会留下永久 claimed 条目。
  //
  // B4-1：认领是恢复通路的**第一个可判定节点** ⇒ 落一条审计（`action:'claim'`）。
  // 写入放在同步 CAS **之后**（载荷反映真实的认领结果，不是"打算认领"）。
  if (!registry.claim(signal.sessionId, entry)) {
    logger.warn('yield 等待已被其他路径认领，本路放弃', {
      sessionId: signal.sessionId,
      entryTurn: entry.turn,
      endedAt: signal.endedAt,
    });
    return false;
  }
  await recordYieldRecovery({
    sessionId: signal.sessionId,
    action: 'claim',
    outcome: 'claimed',
    turn: entry.turn,
    toolCallId: entry.toolCallId,
    restored: signal.restored === true,
  });

  try {
    // B4-2（2026-09-23）：恢复执行器调用是恢复期的**主阻塞点**（内部消费一次
    // `streamMessage`：模型调用 + 落盘）⇒ 包相位 `yield:resume`，
    // 使"恢复期卡住"可归因（`loopProbe` 的 phase 列表与 `summary.md` 逐条输出）。
    const result = await withPhase('yield:resume', () =>
      handler({
        sessionId: signal.sessionId,
        turn: entry.turn,
        toolCallId: entry.toolCallId,
        // O8⑤：重放投递带可见标记（`restored`）—— 恢复可能此前已发生过
        reason: signal.restored
          ? YIELD_SETTLEMENT_RESTORED_REASON
          : 'subagents_settled',
      })
    );
    if (result.ok) {
      // P0-3（M-3 配套修复）：`resolve()` 的返回值**必须判定**。
      // 返回 false = 该登记已被新一轮 yield 取代（引用不等）或已不在表中 ⇒ **未真正记账**；
      // 若此时仍 `return true`，调用方会 `markDelivered` ⇒ 重放不再兜底 + 日志撒谎。
      const recorded = registry.resolve(
        signal.sessionId,
        YIELD_STATUS_RESUMED,
        entry
      );
      if (!recorded) {
        logger.warn('yield 恢复已触发但等待登记未被记账（已被取代或已移除）', {
          sessionId: signal.sessionId,
          entryTurn: entry.turn,
          endedAt: signal.endedAt,
        });
        // B4-1：动作已发生但**未达成目标** ⇒ 审计记 `failed` + 原因（结果可判定）
        await recordYieldRecovery({
          sessionId: signal.sessionId,
          action: 'resume',
          outcome: 'failed',
          turn: entry.turn,
          toolCallId: entry.toolCallId,
          error: 'not_recorded',
        });
        return false;
      }
      // B4-1：恢复是**第二个可判定节点**（`resolved` 记账成功才算真的恢复）
      await recordYieldRecovery({
        sessionId: signal.sessionId,
        action: 'resume',
        outcome: 'resumed',
        turn: entry.turn,
        toolCallId: entry.toolCallId,
        restored: signal.restored === true,
      });
      logger.info('yield 等待已收敛：会话已恢复', {
        sessionId: signal.sessionId,
        turn: entry.turn,
      });
      return true;
    }
    // 恢复失败：作废登记（避免父会话永久停留等待态）
    registry.abandon(signal.sessionId, entry);
    // B4-1：放弃是**第三个可判定节点** ⇒ 审计记 `abandoned` + 原因
    await recordYieldRecovery({
      sessionId: signal.sessionId,
      action: 'abandon',
      outcome: 'abandoned',
      turn: entry.turn,
      toolCallId: entry.toolCallId,
      error: result.error ?? 'unknown',
    });
    logger.warn('yield 恢复失败，等待已作废', {
      sessionId: signal.sessionId,
      error: result.error ?? 'unknown',
    });
    return false;
  } catch (err) {
    registry.abandon(signal.sessionId, entry);
    // B4-1：异常路径同样是"放弃" ⇒ 与失败分支同一条审计（原因取异常文本）
    await recordYieldRecovery({
      sessionId: signal.sessionId,
      action: 'abandon',
      outcome: 'abandoned',
      turn: entry.turn,
      toolCallId: entry.toolCallId,
      error: String(err),
    });
    logger.warn('yield 恢复抛错，等待已作废', {
      sessionId: signal.sessionId,
      error: String(err),
    });
    return false;
  }
}

/**
 * 装配恢复器：把结算监听器挂到 `YieldSettlementBridge`。
 * 返回卸载函数。
 */
export function installYieldResumer(deps: YieldResumerDeps): () => void {
  const listener: YieldSettlementListener = (signal) =>
    handleYieldSettlement(signal, deps);
  yieldSettlementListeners.push(listener);
  logger.info('yield 恢复器已装配', {
    listeners: yieldSettlementListeners.length,
  });
  return () => {
    const index = yieldSettlementListeners.indexOf(listener);
    if (index >= 0) yieldSettlementListeners.splice(index, 1);
  };
}

/**
 * B4-3（2026-09-23）：**注入式崩溃点**的种类（方案 §5-B4-3 v2.2）。
 *
 * 位置都在"**结算写入 → `markDelivered`**"之间：
 * - `after-persist`：结算已写入台账（行仍 `pending`）、**投递尚未发生**（`claim` 之前）；
 * - `after-ack`：投递已返回（**恢复可能已发生**）、台账尚未确认（`markDelivered` 之前）。
 *
 * ⚠ 本环境**无法用 OS 信号精确死在指定点**（Windows 只有 `taskkill /F /PID`，
 * 无法保证恰好死在某一语句之间）⇒ 崩溃点**由 hook 决定，非 OS 信号**：
 * hook 抛错即模拟"进程在此刻断电"，抛出后该行不会被推进到 `delivered`，
 * 盘上留下的状态就是重启后能看到的现场（用例据此断言）。
 */
export type SettlementCrashPoint = 'after-persist' | 'after-ack';

/** 崩溃点上下文（供用例断言/记录） */
export interface SettlementCrashInfo {
  /** 台账行 id */
  outboxId: number;
  sessionId: string;
  endedAt: number;
}

type SettlementCrashHook = (
  point: SettlementCrashPoint,
  info: SettlementCrashInfo
) => void | Promise<void>;

let crashHook: SettlementCrashHook | null = null;

/**
 * 装配/复位崩溃点 hook（**仅测试使用**；生产恒为 `null`）。
 *
 * 生产不调用本函数 ⇒ `runSettlementCrashPoint` 退化为一次布尔判定（零行为变化）。
 */
export function setSettlementCrashHookForTest(
  hook: SettlementCrashHook | null
): void {
  crashHook = hook;
}

/** 到达崩溃点即调用 hook（未装配 ⇒ 直接返回；hook 抛错**不捕获** —— 那就是"断电"） */
async function runSettlementCrashPoint(
  point: SettlementCrashPoint,
  info: SettlementCrashInfo
): Promise<void> {
  if (!crashHook) return;
  await crashHook(point, info);
}

/**
 * O8：**启动回放** —— 把投递台账里"未确认送达"的结算信号重投一次。
 *
 * 场景：进程在"子代理已结算 → 父会话被恢复"之间崩溃 ⇒ 台账留下
 * `pending`（从未发出）或 `attempting`（可能已发出）行。重启后本函数按
 * `listReplayable()`（48h 内、`attempts < 8`）逐行重投：
 * - `claim()` 领取（`attempts+1`，超上限自动转 `dropped`，不再回放）；
 * - 带 **`restored: true`** 投递（恢复侧据此带可见标记，避免重复恢复被误认为首次）；
 * - 收到 ack（`handleYieldSettlement` 返回 `true`）⇒ `delivered`；否则 `failed`（留待下次，直至超限）。
 *
 * @param outbox 可注入（测试用）；缺省取全局单例
 * @returns 成功投递（收到 ack）的行数
 */
export async function replayPendingSettlements(
  deps: YieldResumerDeps,
  outbox: SettlementOutbox = getSettlementOutbox()
): Promise<number> {
  let delivered = 0;
  let candidates: Awaited<ReturnType<SettlementOutbox['listReplayable']>> = [];
  try {
    candidates = await outbox.listReplayable();
  } catch (err) {
    logger.warn('结算回放：读取投递台账失败', { error: String(err) });
    return 0;
  }
  if (candidates.length === 0) return 0;

  for (const row of candidates) {
    // B4-2（2026-09-23）：**单条回放**是一个可归因单元（认领 → 投递 → 落定）
    // ⇒ 包相位 `yield:replay`；其内层还会有 `yield:claim`（台账认领）/
    // `yield:resume`（恢复执行器）/ `yield:state`（台账落定），嵌套关系由活跃栈给出。
    // 顺序与并发语义**不变**（仍未逐行串行 await；相位栈无 I/O）。
    await withPhase('yield:replay', async () => {
      // B4-3：崩溃点①（结算已落台账、投递尚未发生 ⇒ 行仍 `pending`）
      await runSettlementCrashPoint('after-persist', {
        outboxId: row.id,
        sessionId: row.sessionId,
        endedAt: row.endedAt,
      });
      const claimed = await outbox.claim(row.id);
      if (!claimed) return; // 超上限 ⇒ 已被转 dropped
      const ack = await handleYieldSettlement(
        { sessionId: row.sessionId, endedAt: row.endedAt, restored: true },
        deps
      );
      // B4-3：崩溃点②（投递已返回、台账尚未确认 —— 恢复可能已发生）
      await runSettlementCrashPoint('after-ack', {
        outboxId: row.id,
        sessionId: row.sessionId,
        endedAt: row.endedAt,
      });
      if (ack) {
        await outbox.markDelivered(row.id);
        delivered++;
      } else {
        await outbox.markFailed(
          row.id,
          '回放未获 ack（无等待登记或判定不可恢复）'
        );
      }
    });
  }

  logger.info('结算回放完成', {
    candidates: candidates.length,
    delivered,
  });
  return delivered;
}
