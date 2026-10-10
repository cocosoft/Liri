/**
 * Execution 生命周期 —— 管理器（PR1 / 2026-10-09）
 *
 * 职责（见 `.trae/specs/execution-lifecycle-ownership.md` PR1）：
 * - 同 session **原子** `acquire()`：已有占用中的执行 ⇒ 新执行标记 `QUEUED`（**绝不双 RUNNING**）；
 * - 状态机集中收敛（`canTransition`）；
 * - `generation` 递增 + `assertCurrent()` fencing ⇒ 晚到完成不得改写新执行。
 *
 * PR1 为**进程内内存视图**（默认零行为变更）；PR5 起由 DB 派生（durable + recovery）。
 */
import { getLogger } from '@modules/monitoring';
import { configManager } from '@modules/config';
import { StaleExecutionError } from './errors';
import { ExecutionLease } from './ExecutionLease';
import type { ExecutionStore } from './ExecutionStore';
import { emitExecutionEvent } from './eventSink';
import {
  canTransition,
  isActiveStatus,
  isTerminalStatus,
  type ExecutionGeneration,
  type ExecutionId,
  type ExecutionRecord,
  type ExecutionStatus,
  type RecoveryResult,
  type RecoveredUnknownToolCall,
} from './types';

const logger = getLogger('execution:manager');

/** 记录上限（超出时清理最旧的终态记录，防长进程内存无界增长；PR5 改由 DB 承载） */
const MAX_RECORDS = 1000;

/** PR5-S2：心跳陈旧阈值（默认 90s；env `EXEC_HEARTBEAT_STALE_MS` 覆盖） */
export const DEFAULT_EXEC_HEARTBEAT_STALE_MS = 90_000;

/** 解析心跳陈旧阈值（env 非法/缺省 ⇒ 默认值） */
export function resolveHeartbeatStaleMs(): number {
  const raw = configManager.env('EXEC_HEARTBEAT_STALE_MS');
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_EXEC_HEARTBEAT_STALE_MS;
}

let idSeq = 0;
function nextExecutionId(): ExecutionId {
  idSeq += 1;
  return `exec_${Date.now().toString(36)}_${idSeq.toString(36)}` as ExecutionId;
}

export class ExecutionManager {
  private records = new Map<ExecutionId, ExecutionRecord>();
  /** sessionId → 当前持有所有权的执行 */
  private owner = new Map<string, ExecutionId>();
  /** sessionId → 已发放的最大代次 */
  private lastGeneration = new Map<string, number>();
  /**
   * **B-01**（2026-10-09，第九轮审查专项 B）：恢复期被 `kept` 的**外部/前进程**活跃执行。
   *
   * 背景：`recover()` 对心跳新鲜的活跃执行只记 `kept`，**不注入内存** ⇒ 新管理器
   * `acquire()` 认为该 session 空闲 ⇒ 可能并存第二个 `RUNNING`（双执行）。
   *
   * 处置（**不盲目 `owner.set()`** —— 那会把已死执行永久锁死）：
   * 仅把该 session 标记为"**外部占用**"⇒ `acquire()` 对其**只发 `QUEUED`、不发 `RUNNING`**；
   * 当该外部执行在**后续启动**的 `recover()` 中因心跳陈旧被判 `STALE` 时**解除占用**
   * （⇒ 不会永久锁死）。
   */
  private foreignActive = new Map<string, ExecutionId>();
  /**
   * PR5-S2：持久化记录（**opt-in**）。
   *
   * 未接入 ⇒ 纯内存（默认零行为变更，单元测试零副作用）；启动期由 `attachStore()` 接线。
   * DB 是**持久记录 + 恢复依据**，运行时权威仍是本内存状态机（见 `durable-execution.md §2`）。
   */
  private store?: ExecutionStore;

  /** 接入持久化存储（启动期接线） */
  attachStore(store: ExecutionStore): void {
    this.store = store;
  }

  /**
   * **B-05**（2026-10-09，第九轮审查专项 B）：**可等待**的工具调用**开始**记录。
   *
   * 与 `recordToolCall`（fire-and-forget，仅留痕）的区别：本方法**await** 落盘并返回
   * `ok` ⇒ 调用方可在**执行有副作用的工具之前**确认记录已持久化，失败时据此阻止执行/降级。
   *
   * @returns 未接入 store ⇒ `true`（纯内存，与既有 opt-in 语义一致）；落盘失败 ⇒ `false`。
   */
  async beginToolCall(
    executionId: ExecutionId,
    toolCallId: string,
    toolName: string
  ): Promise<boolean> {
    const store = this.store;
    if (!store) return true;
    try {
      await store.recordToolCall(executionId, toolCallId, toolName);
      return true;
    } catch (err) {
      logger.warn('execution beginToolCall 落盘失败（拒绝保证）', {
        executionId,
        toolCallId,
        error: String(err),
      });
      return false;
    }
  }

  /** PR5-S3：记录工具调用开始（写穿 best-effort；未接入 store ⇒ no-op） */
  recordToolCall(
    executionId: ExecutionId,
    toolCallId: string,
    toolName: string
  ): void {
    const store = this.store;
    if (!store) return;
    void store
      .recordToolCall(executionId, toolCallId, toolName)
      .catch((err: unknown) =>
        logger.warn('execution tool_call persist failed（观测面失败仅留痕）', {
          executionId,
          toolCallId,
          error: String(err),
        })
      );
  }

  /** PR5-S3：结算工具调用（写穿 best-effort；未接入 store ⇒ no-op） */
  settleToolCall(
    executionId: ExecutionId,
    toolCallId: string,
    toolName: string,
    status: string,
    error?: string
  ): void {
    const store = this.store;
    if (!store) return;
    void store
      .settleToolCall(executionId, toolCallId, toolName, status, error)
      .catch((err: unknown) =>
        logger.warn('execution tool_call settle failed（观测面失败仅留痕）', {
          executionId,
          toolCallId,
          error: String(err),
        })
      );
  }

  /**
   * 取得执行租约（原子）。
   *
   * 若该 session 已有"占用中"的执行，则本执行以 `QUEUED` 创建且**不取得所有权**
   * （调用方据此排队，绝不允许两个 RUNNING 并存）。
   */
  acquire(sessionId: string, messageId?: string): ExecutionLease {
    this.sweep();

    const generation = ((this.lastGeneration.get(sessionId) ?? 0) +
      1) as ExecutionGeneration;
    this.lastGeneration.set(sessionId, generation);

    const ownerId = this.owner.get(sessionId);
    const ownerRecord = ownerId ? this.records.get(ownerId) : undefined;
    // B-01：内存 owner 之外，**外部/前进程**的活跃执行（recover 期 kept）同样视为"占用"
    // ⇒ 只发 QUEUED，绝不并存两个 RUNNING。
    const occupied =
      (!!ownerRecord && isActiveStatus(ownerRecord.status)) ||
      this.foreignActive.has(sessionId);

    const executionId = nextExecutionId();
    const now = Date.now();
    const status: ExecutionStatus = occupied ? 'QUEUED' : 'RUNNING';
    const record: ExecutionRecord = {
      executionId,
      sessionId,
      messageId,
      generation,
      status,
      startedAt: now,
      updatedAt: now,
      heartbeatAt: now,
    };
    this.records.set(executionId, record);
    if (!occupied) this.owner.set(sessionId, executionId);
    this.persist(record);
    // PR5-S3：落"新建"迁移事件（from=null）
    this.emitStatus(record, null, status);

    logger.info('execution acquire', {
      sessionId,
      executionId,
      generation,
      status,
    });
    return new ExecutionLease(executionId, generation, this);
  }

  /** 心跳（供后续 durability/超时判定；PR5 起同批写穿） */
  heartbeat(executionId: ExecutionId): void {
    const rec = this.records.get(executionId);
    if (!rec || isTerminalStatus(rec.status)) return;
    const now = Date.now();
    rec.heartbeatAt = now;
    rec.updatedAt = now;
    this.persist(rec);
  }

  /** 请求取消（活跃态 → `CANCEL_REQUESTED`；`QUEUED` → 直接 `CANCELLED`）。返回是否已置位。 */
  requestCancel(executionId: ExecutionId, reason: string): boolean {
    const rec = this.records.get(executionId);
    if (!rec) return false;
    const from = rec.status;
    // B-04（2026-10-09，第九轮审查专项 B）：**统一取消入口须覆盖 `QUEUED`**。
    // 状态机不允许 `QUEUED → CANCEL_REQUESTED`（排队中没有"运行中"可中止）⇒ 原实现对排队
    // 记录 `requestCancel` **恒返回 false**（调用方以为已取消，任务仍可能稍后被启动）。
    // 处置：`QUEUED` 直接 `QUEUED → CANCELLED`（状态机已允许）；其余活跃态维持两段式
    // （`CANCEL_REQUESTED` → 等底层确认 → `CANCELLED`）。队列项即 QUEUED 记录本身 ⇒ 置终态即出队。
    const target: ExecutionStatus =
      from === 'QUEUED' ? 'CANCELLED' : 'CANCEL_REQUESTED';
    const ok = this.transition(rec, target);
    if (ok) {
      // 终态（QUEUED ⇒ CANCELLED）需清所有权（与 confirmCancel 同款；QUEUED 通常非 owner，幂等）
      if (
        target === 'CANCELLED' &&
        this.owner.get(rec.sessionId) === executionId
      ) {
        this.owner.delete(rec.sessionId);
      }
      this.persist(rec);
      this.emitStatus(rec, from, target);
      logger.warn(
        target === 'CANCELLED'
          ? 'execution cancel（排队态直接取消）'
          : 'execution cancel requested',
        { executionId, sessionId: rec.sessionId, reason, from, to: target }
      );
    }
    return ok;
  }

  /**
   * 确认取消（`CANCEL_REQUESTED` → `CANCELLED`，两段式取消第二段；PR2）。
   *
   * 仅当执行处于 `CANCEL_REQUESTED`（即已 `requestCancel`）时成功：
   * grace 期内底层执行**已确认停止** ⇒ 置终态并释放 session 所有权；
   * 未确认则调用方**不**调用本方法（保留 lease，不启动下一次）。
   */
  confirmCancel(executionId: ExecutionId): boolean {
    const rec = this.records.get(executionId);
    if (!rec) return false;
    const from = rec.status;
    const ok = this.transition(rec, 'CANCELLED');
    if (ok) {
      if (this.owner.get(rec.sessionId) === executionId) {
        this.owner.delete(rec.sessionId);
      }
      this.persist(rec);
      this.emitStatus(rec, from, 'CANCELLED');
      logger.warn('execution cancelled (confirmed)', {
        executionId,
        sessionId: rec.sessionId,
      });
    }
    return ok;
  }

  /**
   * 标记完成。**fencing**：若本执行已被顶替（非当前 owner）⇒ 置 `STALE` 并抛错，
   * 不改写新执行的 session 状态（"晚到完成"防护）。
   */
  complete(executionId: ExecutionId): void {
    const rec = this.requireOwned(executionId, '完成');
    const from = rec.status;
    if (!this.transition(rec, 'COMPLETED')) {
      throw new StaleExecutionError('非法状态转移 ⇒ 完成被拒绝', {
        executionId,
        status: rec.status,
      });
    }
    this.owner.delete(rec.sessionId);
    this.persist(rec);
    this.emitStatus(rec, from, 'COMPLETED');
  }

  /** 标记失败（与 `complete` 同 fencing 语义） */
  fail(executionId: ExecutionId, error: unknown): void {
    const rec = this.requireOwned(executionId, '失败');
    const from = rec.status;
    if (!this.transition(rec, 'FAILED')) {
      throw new StaleExecutionError('非法状态转移 ⇒ 失败被拒绝', {
        executionId,
        status: rec.status,
      });
    }
    this.owner.delete(rec.sessionId);
    this.persist(rec);
    this.emitStatus(rec, from, 'FAILED');
    logger.warn('execution failed', {
      executionId,
      sessionId: rec.sessionId,
      error: String(error),
    });
  }

  /** 只读记录（返回浅拷贝，防外部改动内部状态） */
  get(executionId: ExecutionId): ExecutionRecord | undefined {
    const rec = this.records.get(executionId);
    return rec ? { ...rec } : undefined;
  }

  /** 当前持有该 session 所有权的执行记录 */
  getBySession(sessionId: string): ExecutionRecord | undefined {
    const ownerId = this.owner.get(sessionId);
    if (!ownerId) return undefined;
    const rec = this.records.get(ownerId);
    return rec ? { ...rec } : undefined;
  }

  /** fencing 断言：本执行须为当前 owner、代次一致、未终结 */
  assertCurrent(
    executionId: ExecutionId,
    generation: ExecutionGeneration
  ): void {
    const rec = this.records.get(executionId);
    if (!rec) {
      throw new StaleExecutionError('执行记录不存在（已释放）', {
        executionId,
      });
    }
    if (rec.generation !== generation) {
      throw new StaleExecutionError('执行代次不匹配（已被新执行顶替）', {
        executionId,
        expected: generation,
        actual: rec.generation,
      });
    }
    if (this.owner.get(rec.sessionId) !== executionId) {
      this.markStale(rec);
      throw new StaleExecutionError('执行已被顶替（晚到续跑被拒绝）', {
        executionId,
        sessionId: rec.sessionId,
      });
    }
    if (isTerminalStatus(rec.status)) {
      throw new StaleExecutionError('执行已结束', {
        executionId,
        status: rec.status,
      });
    }
  }

  /** 非抛出版本 */
  isCurrent(
    executionId: ExecutionId,
    generation: ExecutionGeneration
  ): boolean {
    try {
      this.assertCurrent(executionId, generation);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 释放所有权：
   * - 终态 / QUEUED ⇒ 直接清理记录；
   * - 非终态释放（所有权结束但未完成，可能晚到）⇒ 置 `STALE`。
   */
  release(lease: ExecutionLease): void {
    const rec = this.records.get(lease.executionId);
    if (!rec) return;
    if (this.owner.get(rec.sessionId) === rec.executionId) {
      this.owner.delete(rec.sessionId);
    }
    if (isTerminalStatus(rec.status) || rec.status === 'QUEUED') {
      this.records.delete(rec.executionId);
      return;
    }
    this.markStale(rec);
  }

  /** 清空（测试 / 会话整体重置用） */
  reset(): void {
    this.records.clear();
    this.owner.clear();
    this.lastGeneration.clear();
    this.foreignActive.clear();
  }

  /**
   * PR5-S2：启动期恢复（见 `.trae/specs/durable-execution.md` §3.5）。
   *
   * - 读 `store.listActive()`（占用中：`RUNNING`/`WAITING_USER`/`CANCEL_REQUESTED`）；
   * - 心跳**不陈旧** ⇒ `kept`（视为本进程仍在跑，不误杀）；
   * - 心跳**陈旧** ⇒ 孤儿：置 `STALE` + `generation++`（写回 store），并**不注入内存 owner**
   *   ⇒ 该 session 的下一次 `acquire` 视为空闲（验收 ⑩）；
   * - 按 store 抬高内存 `lastGeneration`，使新执行的代次**严格大于**恢复前
   *   （跨重启 fencing 不回退）。
   *
   * 未接入 store ⇒ no-op（`{recovered:0, kept:0, unknownToolCalls:[]}`）。
   *
   * P0-4（2026-10-10）：返回值新增 `unknownToolCalls` —— 恢复期被判 `unknown` 的工具调用
   * （**副作用不可知**）。组合根据此按工具幂等性（`resolveToolRecoveryPolicy`）判定可否
   * **自动重放**（非幂等/未声明 ⇒ 禁止），避免"库恢复正常但外部世界已重复操作"。
   */
  async recover(opts?: { staleMs?: number }): Promise<RecoveryResult> {
    const store = this.store;
    if (!store) return { recovered: 0, kept: 0, unknownToolCalls: [] };
    const staleMs = opts?.staleMs ?? resolveHeartbeatStaleMs();
    const now = Date.now();
    const active = await store.listActive();
    let recovered = 0;
    let kept = 0;
    // P0-4：恢复期被判 unknown 的工具调用（副作用不可知）—— 供组合根按幂等性判定可否重放
    const unknownToolCalls: RecoveredUnknownToolCall[] = [];
    for (const rec of active) {
      if (now - rec.heartbeatAt <= staleMs) {
        kept++;
        // B-01：登记为**外部占用** ⇒ 该 session 的 acquire 只发 QUEUED（不并存两个 RUNNING）。
        this.foreignActive.set(rec.sessionId, rec.executionId);
        // 表（execution 本地台账）+ 会话事件（轨迹）双写：两者存储用途不同
        await store.appendEvent(rec.executionId, 'execution/recovery', {
          action: 'kept',
          priorStatus: rec.status,
          priorGeneration: rec.generation,
        });
        emitExecutionEvent(rec.sessionId, 'execution/recovery', {
          executionId: rec.executionId,
          action: 'kept',
          priorStatus: rec.status,
          priorGeneration: rec.generation,
        });
        continue;
      }
      const newGen = (rec.generation + 1) as ExecutionGeneration;
      // B-02（2026-10-09，第九轮审查专项 B）：**先**标"未结算工具调用 = unknown"，**再**置 STALE。
      //
      // 原顺序（STALE → unknown）在两步之间崩溃时：该执行已是 STALE（不在 `listActive()`）
      // ⇒ 下次 recover **不会再处理** ⇒ 工具调用**永久停在 running**（不可逆副作用状态不可知）。
      // 倒序后：任一步骤前崩溃，执行**仍 active** ⇒ 下次启动重跑同一分支；
      // `markUnsettledToolCallsUnknown` 是**幂等**的（只改 running 行，重跑无行可改）⇒ 必然收敛。
      const unsettledToolCalls = await store.markUnsettledToolCallsUnknown(
        rec.executionId
      );
      // P0-4：收集被判 `unknown` 的工具调用（副作用不可知），供组合根按**幂等性**判定可否重放。
      // 这也是 `ExecutionStore.listToolCalls` 的**生产消费点**（此前仅测试引用 ⇒ 死 API）。
      if (unsettledToolCalls > 0) {
        const calls = await store.listToolCalls(rec.executionId);
        for (const call of calls) {
          if (call.status === 'unknown') {
            unknownToolCalls.push({
              executionId: rec.executionId,
              sessionId: rec.sessionId,
              toolName: call.toolName,
            });
          }
        }
      }
      const ok = await store.markStale(rec.executionId, newGen);
      if (ok) {
        recovered++;
        // B-01：被判 STALE ⇒ 外部占用解除（session 恢复可用，**不会永久锁死**）。
        this.foreignActive.delete(rec.sessionId);
        await store.appendEvent(rec.executionId, 'execution/recovery', {
          action: 'stale',
          generation: newGen,
          priorStatus: rec.status,
          priorGeneration: rec.generation,
          unsettledToolCalls,
        });
        emitExecutionEvent(rec.sessionId, 'execution/recovery', {
          executionId: rec.executionId,
          action: 'stale',
          priorStatus: rec.status,
          priorGeneration: rec.generation,
          generation: newGen,
          unsettledToolCalls,
        });
      }
    }
    // 抬高内存代次（按 store 中每个涉及 session 的最大值）——跨重启不回退
    for (const sid of new Set(active.map((r) => r.sessionId))) {
      const maxGen = await store.maxGeneration(sid);
      if (maxGen > (this.lastGeneration.get(sid) ?? 0)) {
        this.lastGeneration.set(sid, maxGen);
      }
    }
    logger.info('execution recovery 完成', {
      recovered,
      kept,
      unknownToolCalls: unknownToolCalls.length,
      staleMs,
    });
    return { recovered, kept, unknownToolCalls };
  }

  // ── 内部 ──

  private requireOwned(
    executionId: ExecutionId,
    action: string
  ): ExecutionRecord {
    const rec = this.records.get(executionId);
    if (!rec) {
      throw new StaleExecutionError(`执行记录不存在 ⇒ ${action}被拒绝`, {
        executionId,
      });
    }
    if (this.owner.get(rec.sessionId) !== executionId) {
      this.markStale(rec);
      throw new StaleExecutionError(`执行已被顶替 ⇒ ${action}被拒绝`, {
        executionId,
        sessionId: rec.sessionId,
      });
    }
    return rec;
  }

  private transition(rec: ExecutionRecord, to: ExecutionStatus): boolean {
    if (!canTransition(rec.status, to)) {
      logger.warn('execution 非法状态转移被拒', {
        executionId: rec.executionId,
        from: rec.status,
        to,
      });
      return false;
    }
    rec.status = to;
    rec.updatedAt = Date.now();
    return true;
  }

  private markStale(rec: ExecutionRecord): void {
    if (isTerminalStatus(rec.status)) return;
    const from = rec.status;
    rec.status = 'STALE';
    rec.updatedAt = Date.now();
    this.persist(rec);
    this.emitStatus(rec, from, 'STALE');
  }

  /** PR5-S3：落一条 execution 状态迁移**会话事件**（观测面；未注入 sink ⇒ no-op） */
  private emitStatus(
    rec: ExecutionRecord,
    from: ExecutionStatus | null,
    to: ExecutionStatus
  ): void {
    emitExecutionEvent(rec.sessionId, 'execution/status_changed', {
      executionId: rec.executionId,
      generation: rec.generation,
      from,
      to,
      ...(rec.messageId !== undefined ? { messageId: rec.messageId } : {}),
    });
  }

  /**
   * PR5-S2：best-effort 写穿（失败仅留痕，**不**阻断内存状态机；CS03）。
   * DB 是持久记录，内存才是运行时权威 ⇒ 写失败不构成回退分支。
   */
  private persist(rec: ExecutionRecord): void {
    const store = this.store;
    if (!store) return;
    void store.upsertExecution({ ...rec }).catch((err: unknown) => {
      logger.warn('execution persist failed（内存状态机不受影响）', {
        executionId: rec.executionId,
        error: String(err),
      });
    });
  }

  /** 终态记录超过上限时清理最旧的（防内存无界增长） */
  private sweep(): void {
    if (this.records.size <= MAX_RECORDS) return;
    for (const [id, rec] of this.records) {
      if (this.records.size <= MAX_RECORDS) break;
      if (isTerminalStatus(rec.status)) this.records.delete(id);
    }
  }
}

let _instance: ExecutionManager | null = null;

/** 全局单例（PR1 进程内；PR5 起由 DB 派生） */
export function getExecutionManager(): ExecutionManager {
  if (!_instance) _instance = new ExecutionManager();
  return _instance;
}
