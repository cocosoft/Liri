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
 * B1-3（2026-09-22）：本模块**仍是内存事实源**（`get()` 不落盘），但支持**可注入的
 * 持久化端口**（`setPersistence`）——落盘发生在 `register` / `updateTurn` /
 * `resolve`(abandon) / `clear` 四处，启动时用 `rebuildYieldWaitingSet()` 重建。
 * 未装配端口时行为与修复前完全一致（纯内存）。
 */

import {
  YIELD_STATUS_WAITING,
  YIELD_STATUS_CLAIMED,
  YIELD_STATUS_RESUMED,
  YIELD_STATUS_ABANDONED,
} from './constants';
import type {
  YieldWaitingPersistence,
  YieldWaitingRecord,
  YieldWaitingStore,
} from './YieldWaitingStore';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('session:yield:registry');

export type YieldEntryStatus =
  | typeof YIELD_STATUS_WAITING
  | typeof YIELD_STATUS_CLAIMED
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
   * B1-3（P0-2）：等待集持久化端口（可注入；未装配 ⇒ 纯内存，与修复前行为一致）。
   *
   * 由应用启动装配（`setPersistence(getYieldWaitingStore())`）——**默认不装配**，
   * 使测试/纯内存用法不触碰磁盘。
   */
  private persistence: YieldWaitingPersistence | null = null;

  /** 装配/卸载持久化端口（应用启动时装配真实存储；测试可注入 fake） */
  setPersistence(port: YieldWaitingPersistence | null): void {
    this.persistence = port;
  }

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
    const superseded = this.entries.get(params.sessionId);
    if (superseded) {
      // P1-6（B1-8 收口）：覆盖旧条目前**必须留痕** —— 原实现静默 `set` 替换，
      // 同会话连续两次 yield 时第一次等待"无痕消失"（审计不可见、无法解释现场）。
      // 语义仍为"等价作废"（旧引用的 `resolve/claim` 会被引用不等等拒绝），
      // 但可观测：日志给出被取代条目的身份与原始状态。
      logger.warn('yield 等待被新一轮登记取代（旧条目丢弃）', {
        sessionId: params.sessionId,
        supersededToolCallId: superseded.toolCallId,
        supersededTurn: superseded.turn,
        supersededStatus: superseded.status,
        supersededYieldedAt: superseded.yieldedAt,
      });
    }
    this.entries.set(params.sessionId, entry);
    // B1-3 落盘点①：登记即落盘（否则崩溃重启后"谁在等"丢失 ⇒ 回放必然失败）
    this.persistence?.save(YieldRegistry.toRecord(entry));
    return entry;
  }

  /**
   * B1-3：**启动重建** —— 从持久化记录恢复等待集（**不触发再次落盘**）。
   *
   * 修复前无此能力：重启后等待集为空 ⇒ `replayPendingSettlements` 逐行 `markFailed`。
   * 注意 `turn` 必须一并恢复（只用内存登记的 turn=0 会让 turn 取代判定恒失效）。
   */
  restore(record: YieldWaitingRecord): YieldWaitingEntry {
    const entry: YieldWaitingEntry = {
      sessionId: record.sessionId,
      turn: record.turn,
      toolCallId: record.toolCallId,
      yieldedAt: record.yieldedAt,
      status: YIELD_STATUS_WAITING,
    };
    this.entries.set(record.sessionId, entry);
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
   * B1-1（P0-1 / I1）：**同步 CAS 认领** —— 判定与独占在同一次同步调用内完成。
   *
   * 修复前的临界区（`YieldResumer.handleYieldSettlement`）跨 2 个 `await`：
   * 两路结算各自 `get()` 到同一条目、各自通过 `shouldResume`、各自调用
   * `resumeHandler` ⇒ **父会话被恢复两次、起两个并发 turn**。
   * 本方法**无 `await`**（与 `AgentRunLedger` 同法：临界区不含让出点 ⇒ 交错不可能）。
   *
   * 认领成功后条目落 {@link YIELD_STATUS_CLAIMED}，`get()` 不再返回它
   * ⇒ 其他并发路径的 `claim` / `shouldResume` 一律失败。
   *
   * @param expected 引用相等校验（防"等待期间被新一轮 yield 覆盖"时认领错条目）
   * @returns 是否认领成功（false = 无条目 / 非 waiting / 引用不等）
   */
  claim(sessionId: string, expected?: YieldWaitingEntry): boolean {
    const current = this.entries.get(sessionId);
    if (!current) return false;
    if (current.status !== YIELD_STATUS_WAITING) return false;
    if (expected && current !== expected) return false;
    current.status = YIELD_STATUS_CLAIMED;
    return true;
  }

  /**
   * 补全 turn 编号。
   *
   * 登记发生在工具执行阶段（`ReActToolLoop.act()`），此时 turn 编号尚未产生
   * （只有收尾点写 `turn/end` 时可知），故 `register` 时 turn 记 0，
   * 由收尾点用本方法回填，供 `shouldResume` 的 **turn 取代判定**（判据④）使用。
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
    // B1-3 落盘点②：`turn` 回填必须落盘 —— 否则重启后 `turn` 恒 0（内存登记的初值）
    // ⇒ turn 取代判定（`shouldResume` 判据④）恒失效 ⇒ B1-1 要防的"重复恢复"从后门回来（§14.2 洞①）
    this.persistence?.save(YieldRegistry.toRecord(current));
    return true;
  }

  /**
   * 判定①：登记是否已被后续轮次取代（本轮 turn 已推进 ⇒ 旧登记不得复用）。
   *
   * `turn === 0` 表示"登记后尚未被收尾点回填"（`updateTurn` 之前），
   * 此时无轮次可比 ⇒ **不构成取代**（否则结算恰落在「登记 → 收尾」窗口内即被误判作废）。
   *
   * B1-8 收口（2026-09-22）：**保留本判定**（不引入 `resumeToken`），并作为
   * `shouldResume` 判据④的**唯一实现**（后者改为委托本方法 ⇒ 消除两处漂移）。
   * 校准：前两轮复查称本方法"零调用方（僵尸方法）"—— 该结论**只对 `app/src` 成立**；
   * `tests/session/yieldSemantics.test.ts` 有 6 处调用 ⇒ 不能删（原计划"删除"已撤回）。
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
    // 判据④**委托** `isSuperseded`（B1-8：单一实现 ⇒ 不再内联等价三行）
    if (this.isSuperseded(input.sessionId, input.latestTurn)) return false;
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
    // B1-3 落盘点③（**方案"三处"之外的必需项**）：终态必须**删除**持久化行 ——
    // 否则重启重建会把已恢复的等待"复活" ⇒ 对陈旧登记再发起一次恢复。
    // （方案原文只列 register/updateTurn/clear 三处，实施时发现 resolve/abandon 缺它不成立，
    //   见 §15.4 偏离说明。）
    this.persistence?.remove(sessionId);
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

  /** 清空（测试与关停使用；B1-6 的 cleanup 亦调用本方法） */
  clear(): void {
    this.entries.clear();
    // B1-3 落盘点④：关停/清理必须同时清持久化（否则陈旧登记跨实例/跨重启残留）
    this.persistence?.clearAll();
  }

  /** 条目 → 持久化投影（唯一换算点，避免多处字段漂移） */
  private static toRecord(entry: YieldWaitingEntry): YieldWaitingRecord {
    return {
      sessionId: entry.sessionId,
      turn: entry.turn,
      toolCallId: entry.toolCallId,
      yieldedAt: entry.yieldedAt,
    };
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

/**
 * B1-3：**启动重建等待集**（必须先于结算回放执行）。
 *
 * 修复前重启后等待集为空 ⇒ `replayPendingSettlements` 逐行 `markFailed`
 *（8 次后 `dropped`）⇒ O8 台账实为"只写不生效的死信队列"。
 *
 * 装配顺序（B1-4 的启动钩子负责）：
 * ① `registry.setPersistence(getYieldWaitingStore())`
 * ② `await rebuildYieldWaitingSet(store)` —— 恢复"谁在等"（**含 turn**）
 * ③ 再触发 `replayPendingSettlements(...)` —— 此时回放才可能真正命中等待者
 *
 * @returns 恢复的等待条目数
 */
export async function rebuildYieldWaitingSet(
  store: YieldWaitingStore,
  registry: YieldRegistry = getYieldRegistry()
): Promise<number> {
  const records = await store.loadAll();
  for (const record of records) {
    registry.restore(record);
  }
  return records.length;
}
