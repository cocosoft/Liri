// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * YieldRegistry —— yield 等待登记表（阶段 A / A1-b）
 *
 * 口径：`.trae/documents/阶段A-yield真实实现Spec.md` §3-D2 ——
 * yield 时**结束本轮 turn**（写 `finishReason:'yielded'`）并在此登记 waiting，
 * 会话**对外保持 running**（不写 PAUSED）；子代理全部结算后由结算桥恢复。
 *
 * 字段以 Liri 载体定义（对标实现的 `runId` / `turnToken` 在 Liri 侧不存在）：
 * `{ sessionId, turn, toolCallId, yieldedAt, status }`。
 *
 * 本模块纯内存、无 IO；持久化随 C1「运行台账」一并落地，避免本期重复建表。
 */

import {
  YIELD_STATUS_WAITING,
  YIELD_STATUS_RESUMED,
  YIELD_STATUS_ABANDONED,
} from './constants';

export type YieldEntryStatus =
  | typeof YIELD_STATUS_WAITING
  | typeof YIELD_STATUS_RESUMED
  | typeof YIELD_STATUS_ABANDONED;

export interface YieldWaitingEntry {
  /** 发起 yield 的父会话 */
  sessionId: string;
  /** 该 yield 所属的 turn 编号（来自 turn/end.data.turn） */
  turn: number;
  /** 该轮 sessions_yield 的 toolCallId（防重与结算对齐） */
  toolCallId: string;
  /** 登记时间戳（结算收敛的第二道防线：早于它的结算事件一律忽略） */
  yieldedAt: number;
  status: YieldEntryStatus;
}

/**
 * 结算收敛的输入（由调用方从子代理侧取真实运行态）
 */
export interface YieldConvergeInput {
  sessionId: string;
  /** 当前会话最新 turn 编号（判定"登记是否已被后续轮次取代"） */
  latestTurn: number;
  /** 是否仍有活跃的子代理 run（true ⇒ 继续等待） */
  hasActiveRuns: boolean;
  /** 子代理结算时间戳 */
  endedAt: number;
}

export class YieldRegistry {
  /** key = sessionId（同会话同时只允许一个 yield 等待） */
  private entries = new Map<string, YieldWaitingEntry>();

  /**
   * 登记等待。同会话已有条目时**覆盖**（旧条目因引用不等而在 resolve 时被拒，等价于作废）。
   */
  register(params: {
    sessionId: string;
    turn: number;
    toolCallId: string;
    yieldedAt?: number;
  }): YieldWaitingEntry {
    const entry: YieldWaitingEntry = {
      sessionId: params.sessionId,
      turn: params.turn,
      toolCallId: params.toolCallId,
      yieldedAt: params.yieldedAt ?? Date.now(),
      status: YIELD_STATUS_WAITING,
    };
    this.entries.set(params.sessionId, entry);
    return entry;
  }

  /** 取当前等待条目（不存在或非 waiting 返回 undefined） */
  get(sessionId: string): YieldWaitingEntry | undefined {
    const entry = this.entries.get(sessionId);
    return entry?.status === YIELD_STATUS_WAITING ? entry : undefined;
  }

  /** 该会话是否正在等待子代理结算 */
  isWaiting(sessionId: string): boolean {
    return this.get(sessionId) !== undefined;
  }

  /**
   * 补全 turn 编号。
   *
   * 登记发生在工具执行阶段（`ReActToolLoop.act()`），此时 turn 编号尚未产生
   * （只有收尾点写 `turn/end` 时可知），故 `register` 时 turn 记 0，
   * 由收尾点用本方法回填，供 `isSuperseded` / `shouldResume` 的 turn 取代判定使用。
   */
  updateTurn(
    sessionId: string,
    turn: number,
    expected?: YieldWaitingEntry
  ): boolean {
    const current = this.entries.get(sessionId);
    if (!current) return false;
    if (expected && current !== expected) return false;
    current.turn = turn;
    return true;
  }

  /**
   * 判定①：登记是否已被后续轮次取代（本轮 turn 已推进 ⇒ 旧登记不得复用）。
   *
   * `turn === 0` 表示"登记后尚未被收尾点回填"（`updateTurn` 之前），
   * 此时无轮次可比 ⇒ **不构成取代**（否则结算恰落在「登记 → 收尾」窗口内即被误判作废）。
   */
  isSuperseded(sessionId: string, latestTurn: number): boolean {
    const entry = this.get(sessionId);
    if (!entry) return false;
    if (entry.turn === 0) return false;
    return latestTurn > entry.turn;
  }

  /**
   * 判定②：结算收敛（纯判定，无副作用）。全部满足才可恢复：
   * 1. 存在 waiting 条目；
   * 2. 无活跃子代理 run；
   * 3. 结算时间不早于登记时间（早于则视为迟到/旧事件，忽略）；
   * 4. 本轮 turn 未被取代（`turn === 0` 视为未回填，不算取代）。
   */
  shouldResume(input: YieldConvergeInput): boolean {
    const entry = this.get(input.sessionId);
    if (!entry) return false;
    if (input.hasActiveRuns) return false;
    if (input.endedAt < entry.yieldedAt) return false;
    if (entry.turn > 0 && input.latestTurn > entry.turn) return false;
    return true;
  }

  /**
   * 落终态并清除登记。
   *
   * 引用相等校验：仅当当前条目仍是 `expected` 指向的那个才结算
   * （防止"等待期间被新一轮 yield 覆盖"时错结新条目）。
   * 返回是否真的结算。
   */
  resolve(
    sessionId: string,
    status: typeof YIELD_STATUS_RESUMED | typeof YIELD_STATUS_ABANDONED,
    expected?: YieldWaitingEntry
  ): boolean {
    const current = this.entries.get(sessionId);
    if (!current) return false;
    if (expected && current !== expected) return false;
    current.status = status;
    this.entries.delete(sessionId);
    return true;
  }

  /** 作废登记（停止路径／turn 被取代时使用） */
  abandon(sessionId: string, expected?: YieldWaitingEntry): boolean {
    return this.resolve(sessionId, YIELD_STATUS_ABANDONED, expected);
  }

  /** 当前等待的会话数 */
  size(): number {
    return this.entries.size;
  }

  /** 清空（测试与关停使用） */
  clear(): void {
    this.entries.clear();
  }
}

let _registry: YieldRegistry | null = null;

/** 全局单例（与 SubAgentTokenBridge 的"进程级桥"形态一致） */
export function getYieldRegistry(): YieldRegistry {
  if (!_registry) {
    _registry = new YieldRegistry();
  }
  return _registry;
}

/** 重置单例（仅测试使用） */
export function resetYieldRegistry(): void {
  _registry?.clear();
  _registry = null;
}
