// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 跨会话资源治理器（A5，2026-10-05；**阶段 2** 抢占/排队 2026-10-07）
 *
 * 职责（见 `.trae/specs/cross-session-resource-governor.md`）：
 * 1. 维护**在飞会话只读视图**（`snapshot()`）；
 * 2. 并发上限观测（超限 ⇒ `logger.warn`，`overLimit:true`）；
 * 3. 提供 `admit` / `release` 生命周期；
 * 4. **阶段 2（P26-1 §9.2，D6=B）**：超限且存在**更低优先级**跨会话在飞者 ⇒ **抢占**
 *    （标记 `preempted` + 经**注入回调**中止其流；未注入回调 ⇒ 退回"仅告警"）；
 * 5. **阶段 2（P26-1 §9.4，D7=b）**：超限且**无可抢占候选** ⇒ `acquire()` **排队等待名额**
 *    （优先级降序 + 同级 FIFO；`release()` 1:1 移交）；**超时 = D12「告警 + 放行」**（不拒绝）。
 * 6. **前端相位 PC-2（2026-10-07）**：抢占/排队/放行时经**注入的观察者**（`onEvent`）下发
 *    `GovernanceEvent` ⇒ 前端区分"被抢占 / 排队中"与"用户中止"（`liveEvents.ts` 接 SSE）。
 *
 * **不做**（明确边界）：跨作用域预算合并、拒绝（D7=c）。
 *
 * 开关：`FEATURE_RESOURCE_GOVERNOR`（**默认 false**）。关闭时 `admit` 恒放行且**不登记**、
 * 不抢占、`snapshot()` 为空 ⇒ 全链零行为变更（把开关判定内聚在治理器内，调用方无分支）。
 *
 * 说明：本模块的 `index.ts` 即实现本体（非纯 barrel）—— 顶层模块的纯 re-export barrel 会
 * 触发门禁 R05-005（见 `scripts/lint-architecture.ts`）。
 */

import { feature } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import type { RequestPriority } from '@modules/types/requestPriority';

import type {
  AdmissionDecision,
  AdmissionRequest,
  GovernanceObserver,
  InFlightEntry,
  PreemptHandler,
  QueueOptions,
  ResourceGovernorOptions,
} from './types.js';

export * from './types.js';
export {
  RESOURCE_GOVERNOR_SSE_EVENT,
  buildResourceGovernorPayload,
  emitResourceGovernorEvent,
} from './liveEvents.js';

const logger = getLogger('resourceGovernor');

/** 缺省并发上限（仅观测；超出只告警。后续若限流，再引入配置项） */
export const DEFAULT_MAX_INFLIGHT_SESSIONS = 8;

/**
 * 缺省排队等待上限（毫秒；D7=b，§9.4）
 *
 * 口径参考 `core/SimpleMutex` 的 30s 等待上限；超时按 **D12「告警 + 放行」**（不拒绝）。
 */
export const DEFAULT_QUEUE_TIMEOUT_MS = 30_000;

/** 排队等待者（**优先级降序 + 同级 FIFO** —— 对齐既有 `ResourceScheduler` 的排队/插队口径） */
interface QueueWaiter {
  sessionId: string;
  priority: RequestPriority;
  settled: boolean;
  resolve: () => void;
  timer: ReturnType<typeof setTimeout>;
}

function normalizeMax(value: number): number {
  return Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_MAX_INFLIGHT_SESSIONS;
}

function governorEnabled(): boolean {
  return feature('RESOURCE_GOVERNOR');
}

/** 优先级次序（越大越高；CS02：枚举映射，**禁止**用字符串比较/匹配做业务判定） */
const PRIORITY_RANK: Record<RequestPriority, number> = {
  background: 0,
  interactive: 1,
};

/**
 * 选出被抢占者（**纯函数**，可单测；P26-1 §9.2 D6=B）
 *
 * 规则（四条，顺序不可调换；见 spec §9.2「victim 选择规则」）：
 * 1. **排除同 `sessionId`**（硬约束 —— 同会话"新请求顶替旧流"已由 `_prepareStreamSession`
 *    处理，二次中止会语义冲突，spec §8-3）；
 * 2. **排除优先级不低于请求者**的条目（否则 `background` 可抢占 `interactive` ⇒ 违背
 *    spec §9.8-1「后台任务不挤占人工对话」）；
 * 3. **排除已被抢占者**（`preempted === true` ⇒ 幂等，不重复中止/不重复告警）；
 * 4. 余者取**优先级最低**；同优先级取 `startedAt` **最早**。
 *
 * @returns 无可抢占候选 ⇒ `undefined`
 */
export function selectPreemptionVictim(
  entries: readonly InFlightEntry[],
  requesterSessionId: string,
  requesterPriority: RequestPriority
): InFlightEntry | undefined {
  const requesterRank = PRIORITY_RANK[requesterPriority];
  let victim: InFlightEntry | undefined;

  for (const entry of entries) {
    if (entry.sessionId === requesterSessionId) continue; // ① 不得抢占同会话
    if (entry.preempted) continue; // ③ 幂等
    if (PRIORITY_RANK[entry.priority] >= requesterRank) continue; // ② 只抢更低优先

    if (
      !victim ||
      PRIORITY_RANK[entry.priority] < PRIORITY_RANK[victim.priority] || // ④ 优先最低
      (PRIORITY_RANK[entry.priority] === PRIORITY_RANK[victim.priority] &&
        entry.startedAt < victim.startedAt) // ④ 同级最早
    ) {
      victim = entry;
    }
  }

  return victim;
}

export class ResourceGovernor {
  private readonly maxInflight: number;
  private readonly inflight = new Map<string, InFlightEntry>();
  /** 抢占回调（组合根注入；缺省 ⇒ 不抢占） */
  private onPreempt?: PreemptHandler;
  /** 治理事件观察者（组合根注入；缺省 ⇒ 仅日志，不下发 —— PC-2） */
  private onEvent?: GovernanceObserver;
  /** 排队等待者（**优先级降序 + 同级 FIFO**；§9.4 D7=b） */
  private readonly waiters: QueueWaiter[] = [];

  constructor(options: ResourceGovernorOptions = {}) {
    this.maxInflight = normalizeMax(
      options.maxInflight ?? DEFAULT_MAX_INFLIGHT_SESSIONS
    );
    this.onPreempt = options.onPreempt;
    this.onEvent = options.onEvent;
  }

  /** 注入/替换抢占回调（组合根专用；见 `setResourceGovernorPreemptHandler`） */
  setPreemptHandler(handler: PreemptHandler): void {
    this.onPreempt = handler;
  }

  /** 注入/替换治理事件观察者（组合根专用；见 `setResourceGovernorObserver`） */
  setEventObserver(observer: GovernanceObserver): void {
    this.onEvent = observer;
  }

  /** 上限（供调用方/日志用） */
  get limit(): number {
    return this.maxInflight;
  }

  /** 在飞会话只读快照（按准入时间升序；返回副本，外部改动不影响内部） */
  snapshot(): InFlightEntry[] {
    if (!governorEnabled()) return [];
    return [...this.inflight.values()]
      .map((entry) => ({ ...entry }))
      .sort((a, b) => a.startedAt - b.startedAt);
  }

  /** 当前在飞数（开关关闭 ⇒ 0） */
  count(): number {
    return governorEnabled() ? this.inflight.size : 0;
  }

  /**
   * 准入：登记在飞（**同 sessionId 重复准入幂等**，保留首次 `startedAt`）并返回决策。
   *
   * 超限（`inFlightCount > maxInflight`）时按 **D6=B** 尝试抢占：存在**更低优先级**的
   * **跨会话**在飞者 ⇒ 标记其 `preempted` 并调用注入的 `onPreempt`（中止其流）。
   * **未注入回调 ⇒ 退回阶段 1 的"仅告警"**（零行为变更）。
   *
   * `admitted` 恒 `true`（D4 语义未变：抢占不改变本次请求的准入结果）。
   */
  admit(req: AdmissionRequest): AdmissionDecision {
    if (!governorEnabled()) {
      return {
        admitted: true,
        inFlightCount: 0,
        limit: this.maxInflight,
        overLimit: false,
        preempted: [],
      };
    }

    if (!this.inflight.has(req.sessionId)) {
      this.inflight.set(req.sessionId, {
        sessionId: req.sessionId,
        priority: req.priority,
        startedAt: Date.now(),
      });
    }

    const inFlightCount = this.inflight.size;
    const overLimit = inFlightCount > this.maxInflight;
    const preempted: string[] = [];

    if (overLimit) {
      const victim = selectPreemptionVictim(
        [...this.inflight.values()],
        req.sessionId,
        req.priority
      );

      if (victim && this.onPreempt) {
        // 先标记后回调（幂等 + 防重入再次选中同一 victim）
        victim.preempted = true;
        preempted.push(victim.sessionId);
        this.onEvent?.({ sessionId: victim.sessionId, state: 'preempted' });
        logger.warn('抢占在飞会话（D6=B：中止并丢弃，不落检查点）', {
          victimSessionId: victim.sessionId,
          victimPriority: victim.priority,
          requesterSessionId: req.sessionId,
          requesterPriority: req.priority,
          inFlightCount,
          limit: this.maxInflight,
        });
        this.onPreempt(victim.sessionId, req.sessionId);
      } else {
        logger.warn('在飞会话数超过上限（无可抢占候选，仅观测不拦截）', {
          sessionId: req.sessionId,
          priority: req.priority,
          inFlightCount,
          limit: this.maxInflight,
        });
      }
    }

    return {
      admitted: true,
      inFlightCount,
      limit: this.maxInflight,
      overLimit,
      preempted,
    };
  }

  /** 结束在飞（幂等）；返回是否确有条目被移除。**移除即唤醒一个排队者**（§9.4 名额移交） */
  release(sessionId: string): boolean {
    if (!governorEnabled()) return false;
    const removed = this.inflight.delete(sessionId);
    if (removed) this.wakeOneWaiter();
    return removed;
  }

  /** 当前排队长度（观测用；开关关闭 ⇒ 0） */
  queueLength(): number {
    return governorEnabled() ? this.waiters.length : 0;
  }

  /**
   * 准入 + **排队等待名额**（D7=b，§9.4）
   *
   * 语义：
   * - 未超限 / 已触发抢占（名额即将释放）/ 开关关闭 ⇒ **直接返回**（不等待）；
   * - 超限且**无可抢占候选** ⇒ 入队等待 `release()` 移交名额；
   * - **超时 ⇒ 按 D12「告警 + 放行」**（`logger.warn` 后照常返回，**不拒绝**）。
   *
   * ⚠️ 排队期间该会话**已在 `admit()` 中登记为在飞**（既有准入契约不变 ⇒ `snapshot()` 含之）。
   * 返回值与 `admit()` 同一决策对象（`admitted` 恒 `true`，D4 语义未变）。
   */
  async acquire(
    req: AdmissionRequest,
    options: QueueOptions = {}
  ): Promise<AdmissionDecision> {
    const decision = this.admit(req);
    if (
      !governorEnabled() ||
      !decision.overLimit ||
      decision.preempted.length > 0
    ) {
      return decision;
    }
    await this.enqueue(
      req.sessionId,
      req.priority,
      options.timeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS
    );
    return decision;
  }

  /** 入队一个等待者（**同 sessionId 幂等**：已在队中则不重复入队） */
  private enqueue(
    sessionId: string,
    priority: RequestPriority,
    timeoutMs: number
  ): Promise<void> {
    if (this.waiters.some((w) => w.sessionId === sessionId)) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      const waiter: QueueWaiter = {
        sessionId,
        priority,
        settled: false,
        resolve,
        timer: undefined as unknown as ReturnType<typeof setTimeout>,
      };

      waiter.timer = setTimeout(() => {
        if (waiter.settled) return;
        waiter.settled = true;
        this.removeWaiter(waiter);
        this.onEvent?.({ sessionId, state: 'released' }); // D12 放行 ⇒ 清除前端"排队中"
        logger.warn('排队等待超时，按 D12 放行（告警 + 放行，不拒绝）', {
          sessionId,
          priority,
          timeoutMs,
          remainingQueue: this.waiters.length,
          inFlightCount: this.inflight.size,
          limit: this.maxInflight,
        });
        resolve();
      }, timeoutMs);

      // 插入位置：优先级降序；同级 FIFO（插到首个「优先级更低」者之前；无则入尾）
      const rank = PRIORITY_RANK[priority];
      const idx = this.waiters.findIndex(
        (w) => PRIORITY_RANK[w.priority] < rank
      );
      if (idx === -1) this.waiters.push(waiter);
      else this.waiters.splice(idx, 0, waiter);

      this.onEvent?.({
        sessionId,
        state: 'queued',
        queuePosition: this.waiters.indexOf(waiter) + 1,
      });
      logger.info('超限排队等待名额', {
        sessionId,
        priority,
        queueLength: this.waiters.length,
        inFlightCount: this.inflight.size,
        limit: this.maxInflight,
        timeoutMs,
      });
    });
  }

  /** 唤醒一个（优先级最高的）等待者；名额每次 `release()` 移交一个（1:1 交接） */
  private wakeOneWaiter(): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift() as QueueWaiter;
      if (waiter.settled) continue;
      waiter.settled = true;
      clearTimeout(waiter.timer);
      this.onEvent?.({ sessionId: waiter.sessionId, state: 'released' });
      waiter.resolve();
      return;
    }
  }

  private removeWaiter(waiter: QueueWaiter): void {
    const idx = this.waiters.indexOf(waiter);
    if (idx >= 0) this.waiters.splice(idx, 1);
  }

  /** 清空（仅测试用） */
  reset(): void {
    for (const waiter of this.waiters) {
      if (waiter.settled) continue;
      waiter.settled = true;
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    this.waiters.length = 0;
    this.inflight.clear();
  }
}

let globalGovernor: ResourceGovernor | null = null;

/** 全局治理器（唯一实例） */
export function getResourceGovernor(): ResourceGovernor {
  if (!globalGovernor) globalGovernor = new ResourceGovernor();
  return globalGovernor;
}

/** 测试用：重置全局治理器（对齐既有 `reset*ForTest` 约定） */
export function resetResourceGovernorForTest(): void {
  globalGovernor = null;
}

/**
 * 注入抢占回调（P26-1 §9.2 D6=B）—— **组合根专用**（`BootPipelineIntegrator`）
 *
 * 治理器**不硬依赖** chat 层：由入口层装配
 * `(victimSessionId) => chatManager.abortSessionStream(victimSessionId)`。
 * 未注入 ⇒ `admit()` 超限时退回阶段 1 的"仅告警"（零行为变更）。
 */
export function setResourceGovernorPreemptHandler(
  handler: PreemptHandler
): void {
  getResourceGovernor().setPreemptHandler(handler);
}

/**
 * 注入治理事件观察者（P26-1 前端相位 **PC-2**）—— **组合根专用**（`BootPipelineIntegrator`）
 *
 * 治理器**不依赖传输层**：由入口层装配为 `emitResourceGovernorEvent`（`liveEvents.ts`，
 * 经全局 SSE 下发 `/v1/events`）。未注入 ⇒ 抢占/排队仅落日志，**不下发**（零行为变更）。
 */
export function setResourceGovernorObserver(
  observer: GovernanceObserver
): void {
  getResourceGovernor().setEventObserver(observer);
}
