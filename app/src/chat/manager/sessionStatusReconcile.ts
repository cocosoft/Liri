// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 会话状态对账 / 「在飞轮次」探针（2026-11-21）
 *
 * **真机问题**（本机 61 个会话）：52 个 `paused` + 4 个 `error`，逐个核对 `events.jsonl` 后
 * 发现**最后一个 turn 全部已闭合**（`terminationReason=completed` / `awaiting_approval`）——
 * 也就是说这些会话根本没有被中断，徽标是"陈旧"的。
 *
 * **根因**：`CrashRecoveryManager` 以「持久化状态为 ACTIVE/RUNNING + 有活动」判定"上次崩溃时
 * 这轮还在跑"，但 `active` 在本项目里的语义是**"可继续对话"**（见
 * `resolveSessionStateAfterMessage` 的口径），一轮正常结束后并不会改写 ⇒ 每次**非优雅**退出
 * （强杀 / 崩溃 / 容器重启）都会把所有用过的会话批量标成 paused（idle ≤30min）或 error（>30min）。
 *
 * **本模块做两件事（都不猜原因）**：
 *   ① `createTurnOpenProbe`：给崩溃恢复提供"该会话最后一个 turn 是否仍未闭合"的**事实判定**
 *      （事实源 = 事件日志，与 `pendingSuspensions` 同源语义）；
 *   ② `reconcileInterruptedSessionStatuses`：启动期一次性对账**历史遗留**的陈旧徽标
 *      （仅限 `metadata.crashRecovery` 为 `recovered_paused` / `failed_stale` 且轮次已闭合的会话），
 *      按**同一套收尾原因口径**收回 `active` / `requires_action`。
 *
 * 属于「会话恢复」关键域（见 code-deletion.md CD07）：只新增判定与对账，**不删除**既有恢复路径。
 */

import { getLogger } from '@openliri/infra/monitoring';
import { classifyTurnTail } from '@modules/session';
import type {
  EventLogStorage,
  SessionGateway,
  TurnTailEvent,
  TurnTailInfo,
} from '@modules/session';
import { SessionStatus } from '@modules/session/types/UnifiedSession';

import {
  FAILED_TURN_REASONS,
  PAUSED_TURN_REASONS,
  SUCCESS_TURN_REASONS,
} from '../terminationOutput';
import { TRANSIENT_AWAITING_APPROVAL } from '../services/ToolExecutionService';

const logger = getLogger('chat:sessionStatusReconcile');

/** 尾部扫描窗口（事件条数）。`turn/end` 是每轮最后写入的事件之一 ⇒ 窗口内通常必命中 */
const TAIL_SCAN_WINDOW = 500;

/** 窗口扩张上限（防病态日志拖慢启动；到上限仍无 turn 事件 ⇒ 按未闭合保守处理） */
const TAIL_SCAN_CAP = 100_000;

/** 崩溃恢复写下的元数据标记（只有这两类才值得对账） */
const CRASH_MARKERS: ReadonlySet<string> = new Set([
  'recovered_paused',
  'failed_stale',
]);

/** 对账用：需要从 metadata 中清除的崩溃痕迹 */
const CRASH_META_KEYS = [
  'crashRecovery',
  'crashedAt',
  'lastActivityBeforeCrash',
] as const;

/**
 * 2026-11-25：判定函数已**下沉到 service**（`@modules/session` 的 `classifyTurnTail`）——
 * 人工复位（runtime 层）与崩溃恢复探针必须同一判据，留在 app 层会造成 `runtime → chat`
 * 分层违规。此处保留同名 re-export，既有调用点与测试逐字不变。
 */
export { classifyTurnTail };
export type { TurnTailEvent, TurnTailInfo };

/**
 * 读某会话尾部 turn 事件。
 *
 * 窗口从 {@link TAIL_SCAN_WINDOW} 起按 4 倍扩张，直到命中 turn 事件或扫到日志开头 ——
 * 长工具轮次（一轮几百条事件）也能量到"这一轮到底闭合没有"。
 * 扩到 {@link TAIL_SCAN_CAP} 仍无 turn 事件（病态日志）⇒ 保守按"未闭合"处理，
 * 宁可保留徽标也不误收回。
 */
async function readTurnTail(
  getOrCreateEventLog: (sessionId: string) => EventLogStorage,
  sessionId: string
): Promise<TurnTailInfo> {
  const log = getOrCreateEventLog(sessionId);
  const tail = await log.getTailSeq();
  if (!tail || tail <= 0) return { open: false, hasTurn: false };

  let window = TAIL_SCAN_WINDOW;
  for (;;) {
    const fromSeq = Math.max(1, tail - window);
    const events = await log.read({
      fromSeq,
      types: ['turn/start', 'turn/end'],
    });
    if (events.length > 0) {
      return classifyTurnTail(events as TurnTailEvent[]);
    }
    if (fromSeq === 1) return { open: false, hasTurn: false };
    if (window >= TAIL_SCAN_CAP) return { open: true, hasTurn: true };
    window *= 4;
  }
}

/**
 * 生成崩溃恢复用的「在飞轮次」探针。
 *
 * 判定失败（读盘异常）由调用方兜底 —— `CrashRecoveryManager` 侧会把异常当作"可能中断"（保守）。
 */
export function createTurnOpenProbe(
  getOrCreateEventLog: (sessionId: string) => EventLogStorage
): (sessionId: string) => Promise<boolean> {
  return async (sessionId: string) => {
    const tail = await readTurnTail(getOrCreateEventLog, sessionId);
    return tail.open;
  };
}

export interface ReconcileStats {
  /** 收回为 active / requires_action 的会话数 */
  reconciled: number;
  /** 仍在飞、或收尾原因不支持收回（失败/可续 ⇒ 保留原状）的会话数 */
  kept: number;
}

/**
 * 按收尾原因决定"陈旧徽标"应收回成什么状态。
 *
 * 只处理两类可确定的迁移：正常收尾 ⇒ `active`（可继续对话）、等待审批 ⇒ `requires_action`。
 * 失败 / 可续（`empty_output` / `timeout` …）原因**保持原状** —— 徽标本就如实。
 */
function resolveReconciledStatus(
  reason: string | undefined
): SessionStatus | null {
  if (!reason) return null;
  if (reason === TRANSIENT_AWAITING_APPROVAL)
    return SessionStatus.REQUIRES_ACTION;
  if (SUCCESS_TURN_REASONS.has(reason)) return SessionStatus.ACTIVE;
  if (FAILED_TURN_REASONS.has(reason) || PAUSED_TURN_REASONS.has(reason)) {
    return null;
  }
  return null;
}

/**
 * 启动期一次性对账：`paused` / `error` 且带**崩溃恢复标记**、但最后一个 turn 已闭合的会话
 * ⇒ 按收尾原因收回状态并清除崩溃痕迹（幂等：收回后不再匹配本函数的条件）。
 *
 * 为什么不放在运行时：这类徽标是历史遗留（对账逻辑上线前写下的），运行期的新对话
 * 由 `resolveSessionStateAfterMessage` 正常收敛，不需要本函数参与。
 */
export async function reconcileInterruptedSessionStatuses(deps: {
  gateway: Pick<SessionGateway, 'listSessions' | 'updateSession'>;
  getOrCreateEventLog: (sessionId: string) => EventLogStorage;
}): Promise<ReconcileStats> {
  const stats: ReconcileStats = { reconciled: 0, kept: 0 };
  const sessions = await deps.gateway.listSessions();
  for (const session of sessions) {
    if (
      session.status !== SessionStatus.PAUSED &&
      session.status !== SessionStatus.ERROR
    ) {
      continue;
    }
    const metadata = session.metadata ?? {};
    const marker = metadata.crashRecovery;
    if (typeof marker !== 'string' || !CRASH_MARKERS.has(marker)) continue;
    if (!session.id) continue;

    let tail: TurnTailInfo;
    try {
      tail = await readTurnTail(deps.getOrCreateEventLog, session.id);
    } catch (err) {
      logger.warn('会话状态对账：读事件尾部失败，保持原状', {
        sessionId: session.id,
        error: String(err),
      });
      stats.kept += 1;
      continue;
    }
    if (tail.open) {
      stats.kept += 1;
      continue;
    }
    // 口径：`terminationReason` 是主循环的终态判定（TB-16），优先于 provider 的 finishReason。
    // 旧会话从未被 turn 包裹（无 turn 事件）⇒ 与探针同判"不算被中断"，直接收回 active。
    const next = tail.hasTurn
      ? resolveReconciledStatus(tail.terminationReason ?? tail.finishReason)
      : SessionStatus.ACTIVE;
    if (!next) {
      stats.kept += 1;
      continue;
    }

    const nextMetadata = { ...metadata };
    for (const key of CRASH_META_KEYS) delete nextMetadata[key];
    nextMetadata.statusReconcile = 'closed_turn_cleared';
    try {
      session.status = next;
      session.metadata = nextMetadata;
      await deps.gateway.updateSession(session);
      stats.reconciled += 1;
    } catch (err) {
      logger.warn('会话状态对账：写回失败，保持原状', {
        sessionId: session.id,
        error: String(err),
      });
      stats.kept += 1;
    }
  }

  if (stats.reconciled > 0) {
    logger.info('启动对账：陈旧崩溃徽标已收回（轮次已闭合）', {
      reconciled: stats.reconciled,
      kept: stats.kept,
    });
  }
  return stats;
}
