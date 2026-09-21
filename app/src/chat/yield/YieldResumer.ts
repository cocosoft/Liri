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
import { getYieldRegistry, YIELD_STATUS_RESUMED } from '../../session/yield';
import {
  yieldSettlementListeners,
  type YieldSettlementListener,
  type YieldSettlementSignal,
} from './YieldSettlementBridge';

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
  /** 是否仍有活跃子代理 run（true ⇒ 继续等待） */
  hasActiveRuns: () => boolean;
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
    hasActiveRuns: deps.hasActiveRuns(),
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

  if (!resumeHandler) {
    // 未装配：保持等待（不 resolve、不 abandon）——装配缺失应可观测而非静默
    logger.warn('yield 恢复未装配：等待保留', {
      sessionId: signal.sessionId,
      turn: entry.turn,
    });
    return false;
  }

  try {
    const result = await resumeHandler({
      sessionId: signal.sessionId,
      turn: entry.turn,
      toolCallId: entry.toolCallId,
      reason: 'subagents_settled',
    });
    if (result.ok) {
      registry.resolve(signal.sessionId, YIELD_STATUS_RESUMED, entry);
      logger.info('yield 等待已收敛：会话已恢复', {
        sessionId: signal.sessionId,
        turn: entry.turn,
      });
      return true;
    }
    // 恢复失败：作废登记（避免父会话永久停留等待态）
    registry.abandon(signal.sessionId, entry);
    logger.warn('yield 恢复失败，等待已作废', {
      sessionId: signal.sessionId,
      error: result.error ?? 'unknown',
    });
    return false;
  } catch (err) {
    registry.abandon(signal.sessionId, entry);
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
  const listener: YieldSettlementListener = (signal) => {
    void handleYieldSettlement(signal, deps);
  };
  yieldSettlementListeners.push(listener);
  logger.info('yield 恢复器已装配', {
    listeners: yieldSettlementListeners.length,
  });
  return () => {
    const index = yieldSettlementListeners.indexOf(listener);
    if (index >= 0) yieldSettlementListeners.splice(index, 1);
  };
}
