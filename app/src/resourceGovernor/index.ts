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
 *    （标记 `preempted` + 经**注入回调**中止其流；未注入回调 ⇒ 退回"仅告警"）。
 *
 * **不做**（明确边界）：跨作用域预算合并、拒绝（D7=c）、排队（D7=b，§9.4 尚未落地）。
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
  InFlightEntry,
  PreemptHandler,
  ResourceGovernorOptions,
} from './types.js';

export * from './types.js';

const logger = getLogger('resourceGovernor');

/** 缺省并发上限（仅观测；超出只告警。后续若限流，再引入配置项） */
export const DEFAULT_MAX_INFLIGHT_SESSIONS = 8;

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

  constructor(options: ResourceGovernorOptions = {}) {
    this.maxInflight = normalizeMax(
      options.maxInflight ?? DEFAULT_MAX_INFLIGHT_SESSIONS
    );
    this.onPreempt = options.onPreempt;
  }

  /** 注入/替换抢占回调（组合根专用；见 `setResourceGovernorPreemptHandler`） */
  setPreemptHandler(handler: PreemptHandler): void {
    this.onPreempt = handler;
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

  /** 结束在飞（幂等）；返回是否确有条目被移除 */
  release(sessionId: string): boolean {
    if (!governorEnabled()) return false;
    return this.inflight.delete(sessionId);
  }

  /** 清空（仅测试用） */
  reset(): void {
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
