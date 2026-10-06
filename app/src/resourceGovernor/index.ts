// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 跨会话资源治理器（A5，2026-10-05）
 *
 * 职责（**仅此三项**，见 `.trae/specs/cross-session-resource-governor.md` §3.2 方案 A）：
 * 1. 维护**在飞会话只读视图**（`snapshot()`）；
 * 2. 并发上限**观测**（超限 ⇒ `logger.warn`，`overLimit:true`）；
 * 3. 提供 `admit` / `release` 生命周期。
 *
 * **不做**（明确边界）：抢占、排队、拒绝、跨作用域预算合并 —— 均属独立专项。
 *
 * 开关：`FEATURE_RESOURCE_GOVERNOR`（**默认 false**）。关闭时 `admit` 恒放行且**不登记**、
 * `snapshot()` 为空 ⇒ 全链零行为变更（把开关判定内聚在治理器内，调用方无分支）。
 *
 * 说明：本模块的 `index.ts` 即实现本体（非纯 barrel）—— 顶层模块的纯 re-export barrel 会
 * 触发门禁 R05-005（见 `scripts/lint-architecture.ts`）。
 */

import { feature } from '@modules/core';
import { getLogger } from '@modules/monitoring';

import type {
  AdmissionDecision,
  AdmissionRequest,
  InFlightEntry,
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

export class ResourceGovernor {
  private readonly maxInflight: number;
  private readonly inflight = new Map<string, InFlightEntry>();

  constructor(options: ResourceGovernorOptions = {}) {
    this.maxInflight = normalizeMax(
      options.maxInflight ?? DEFAULT_MAX_INFLIGHT_SESSIONS
    );
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
   * 当前策略恒 `admitted:true`（D4=仅告警不拦截）。
   */
  admit(req: AdmissionRequest): AdmissionDecision {
    if (!governorEnabled()) {
      return {
        admitted: true,
        inFlightCount: 0,
        limit: this.maxInflight,
        overLimit: false,
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
    if (overLimit) {
      logger.warn('在飞会话数超过上限（仅观测，不拦截）', {
        sessionId: req.sessionId,
        priority: req.priority,
        inFlightCount,
        limit: this.maxInflight,
      });
    }
    return {
      admitted: true,
      inFlightCount,
      limit: this.maxInflight,
      overLimit,
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
