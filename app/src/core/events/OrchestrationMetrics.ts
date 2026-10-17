/**
 * 编排指标统计
 *
 * 挂在 globalEventBus 上作为中间件，订阅所有 Orchestration 事件，
 * 统计事件频率和延迟分布，提供后端可观测性。
 *
 * 通过 getStats() 获取 P50/P95 延迟分位数，
 * 可选对接 OTel Metrics（通过 OTelMetrics 实例）。
 *
 * ## 耗时口径（T-13-b，2026-10-17）
 * 事件本身不携带耗时，`recordEvent` 的外部调用方也无人注入 `latencyMs`（修复前恒 `undefined`
 * ⇒ P50/P95 恒 0）。本模块改为**在订阅端按「起始事件 → 终止事件」配对派生**：
 * - 起始事件到达时记录 `Date.now()`（按关联键分桶，FIFO 支持并发/嵌套）；
 * - 终止事件到达时取出最早的一条起始时刻，差值即该次链路耗时；
 * - 耗时**记在起始事件类型上**（与 `EventBusOTelBridge` 的 span 语义一致：
 *   `orch:plan:start` 的 p50/p95 = 计划链路 起→终 耗时）。
 *
 * 关联键取载荷中的稳定标识（`planId` / `chainId` / `taskId` / `sessionId` 等）；
 * 载荷缺键或两侧键不一致时，仅在「该起始事件仅有一个待配对桶」时退化配对，
 * 避免跨会话错配（CS06：宁可少样本，不伪造）。
 */

import { OrchestrationEventType } from '@modules/types/orchestrationEvents';
import { globalEventBus, type EventSubscription } from './EventBus';
import { getLogger } from '../loggerFacade.js';

/**
 * OTel Metrics **端口**（core 侧声明，上层注入）
 *
 * 2026-09-30（台账 D-70 Phase 2）：原直接 `import type { OTelMetrics }`（monitoring，infra）
 * 构成 `core -> infra` 倒挂。本能力是**可选注入**（setter 注入、非注册式 SPI）—— 故按
 * D-59 的「core 声明结构接口 + 上层实现结构化满足」手法就地声明端口：
 * 只需把入参类型换成端口，调用方仍照常传 monitoring 的 `OTelMetrics` 实例（结构化兼容），
 * **无需任何注册缝或调用方改动**。
 */
export interface IOTelMetricsPort {
  /** 递增计数器 */
  incrementCounter(
    name: string,
    value: number,
    attributes?: Record<string, string | number | boolean>
  ): void;
  /** 记录直方图观测值 */
  recordHistogram(
    name: string,
    value: number,
    attributes?: Record<string, string | number | boolean>
  ): void;
}
const logger = getLogger('core:events:OrchestrationMetrics');

/** 滑动窗口大小（记录最近 N 条延迟） */
const SLIDING_WINDOW_SIZE = 100;

/** 单个关联键最多保留的待配对起始时刻（超出丢弃最旧，防无终态事件导致无界增长） */
const MAX_PENDING_PER_KEY = 32;

/** 单个起始事件类型最多保留的关联键数（同上，防止键空间无界增长） */
const MAX_PENDING_KEYS = 256;

/**
 * 终止事件 → 起始事件（耗时配对表）
 *
 * 与 `EventBusOTelBridge.END_EVENT_TO_START` 同源，并补齐其未覆盖的
 * PLAN / CHAIN / PARALLEL / STEP 链路（本模块是**指标**口径，需要全链路覆盖）。
 */
const END_TO_START_EVENT: Record<string, string> = {
  [OrchestrationEventType.ORCH_END]: OrchestrationEventType.ORCH_START,
  [OrchestrationEventType.ORCH_ERROR]: OrchestrationEventType.ORCH_START,
  [OrchestrationEventType.ORCH_TASK_END]:
    OrchestrationEventType.ORCH_TASK_START,
  [OrchestrationEventType.ORCH_STEP_COMPLETED]:
    OrchestrationEventType.ORCH_STEP_START,
  [OrchestrationEventType.PLAN_COMPLETED]: OrchestrationEventType.PLAN_START,
  [OrchestrationEventType.PLAN_STEP_COMPLETED]:
    OrchestrationEventType.PLAN_STEP_START,
  [OrchestrationEventType.CHAIN_END]: OrchestrationEventType.CHAIN_START,
  [OrchestrationEventType.COUNCIL_END]: OrchestrationEventType.COUNCIL_START,
  [OrchestrationEventType.SWARM_COMPLETE]:
    OrchestrationEventType.SWARM_DISPATCH,
  [OrchestrationEventType.RULE_CHECK_PASS]:
    OrchestrationEventType.RULE_CHECK_START,
  [OrchestrationEventType.RULE_CHECK_FAIL]:
    OrchestrationEventType.RULE_CHECK_START,
  [OrchestrationEventType.PARALLEL_END]: OrchestrationEventType.PARALLEL_START,
};

/** 需要登记起始时刻的事件类型集合 */
const START_EVENTS = new Set<string>(Object.values(END_TO_START_EVENT));

/**
 * 起始事件的关联键字段（按顺序取值拼接）
 *
 * 未列出的起始事件（`PARALLEL_START` / `SWARM_DISPATCH`）载荷无稳定标识 ⇒ 单桶 FIFO。
 */
const PAIR_KEY_FIELDS: Record<string, readonly string[]> = {
  [OrchestrationEventType.ORCH_START]: ['workItemId'],
  [OrchestrationEventType.ORCH_TASK_START]: ['taskId'],
  [OrchestrationEventType.ORCH_STEP_START]: ['taskId', 'stepName'],
  [OrchestrationEventType.PLAN_START]: ['planId'],
  [OrchestrationEventType.PLAN_STEP_START]: ['planId', 'stepIndex'],
  [OrchestrationEventType.CHAIN_START]: ['chainId'],
  [OrchestrationEventType.COUNCIL_START]: ['sessionId'],
  [OrchestrationEventType.RULE_CHECK_START]: ['ruleId', 'filePath'],
};

/**
 * 从载荷提取关联键
 *
 * @returns 各字段值拼接的键；任一字段缺失或载荷非对象 ⇒ `''`（退化单桶）
 */
function extractPairKey(
  fields: readonly string[] | undefined,
  payload: unknown
): string {
  if (!fields || fields.length === 0) return '';
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as Record<string, unknown>;
  const parts: string[] = [];
  for (const field of fields) {
    const value = obj[field];
    if (value === undefined || value === null) return '';
    parts.push(String(value));
  }
  return parts.join('\u0000');
}

/** 事件类型统计 */
interface EventTypeStats {
  /** 总计数 */
  count: number;
  /** 延迟样本（毫秒，滑动窗口） */
  latencies: number[];
}

/** 单条事件统计快照 */
export interface EventStatSnapshot {
  /** 事件类型 */
  eventType: string;
  /** 发生次数 */
  count: number;
  /** P50 延迟（毫秒） */
  p50: number;
  /** P95 延迟（毫秒） */
  p95: number;
  /** 平均延迟（毫秒） */
  avg: number;
  /** Agent 角色（可选，从事件 payload 中提取） */
  agentRole?: string;
  /** 业务类别（从事件类型前缀推导） */
  category?: string;
}

/** 指标统计总快照 */
export interface MetricsSnapshot {
  /** 各事件类型统计 */
  events: EventStatSnapshot[];
  /** 事件总数 */
  totalEvents: number;
  /** 首次记录时间 */
  startTime: number;
  /** 快照生成时间 */
  timestamp: number;
  /** 按角色聚合 */
  byRole: Record<string, number>;
  /** 按业务类别聚合 */
  byCategory: Record<string, number>;
}

// ========== 多维维度提取（方案 0c 加强：按角色/业务指标拆分） ==========

/** 事件维度信息 */
interface EventDimensions {
  /** Agent 角色（COUNCIL_AGENT_SPEAKING、SWARM_MEMBER_STATUS 等事件携带） */
  agentRole?: string;
  /** 业务类别（从事件类型前缀推导） */
  category?: string;
}

/** 事件类型前缀 → 业务类别映射 */
const EVENT_CATEGORY_MAP: Record<string, string> = {
  COUNCIL_: 'council',
  SWARM_: 'swarm',
  PLAN_: 'plan',
  CHAIN_: 'chain',
  PARALLEL_: 'parallel',
  ORCH_: 'orchestration',
  TOKEN_: 'token',
  AGENT_: 'agent',
};

/**
 * 从事件类型和 payload 中提取维度信息
 *
 * @param eventType 事件类型
 * @param payload 事件 payload（可选）
 * @returns 提取的维度
 */
function extractDimensions(
  eventType: string,
  payload?: unknown
): EventDimensions {
  const dims: EventDimensions = {};

  // 从 payload 中提取 agentRole
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    const role = p.agentRole ?? p.role;
    if (typeof role === 'string') {
      dims.agentRole = role;
    }
  }

  // 从事件类型前缀推导业务类别
  for (const [prefix, category] of Object.entries(EVENT_CATEGORY_MAP)) {
    if (eventType.startsWith(prefix)) {
      dims.category = category;
      break;
    }
  }

  return dims;
}

/**
 * 从事件 payload 中提取状态信息
 *
 * @param payload 事件 payload（可选）
 * @returns 状态字符串，无法提取则返回 undefined
 */
function extractStatus(payload?: unknown): string | undefined {
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    const status = p.status ?? p.state;
    if (typeof status === 'string') {
      return status.toLowerCase();
    }
  }
  return undefined;
}

/**
 * 编排指标统计
 */
export class OrchestrationMetrics {
  /** 事件类型 → 统计信息 */
  private stats: Map<string, EventTypeStats> = new Map();
  /** 角色 → 计数 */
  private roleCounts: Map<string, number> = new Map();
  /** 业务类别 → 计数 */
  private categoryCounts: Map<string, number> = new Map();
  /** 错误事件计数（P1-2.7: 按 category + agent_role 维度） */
  private errorCounts: Map<string, number> = new Map();
  /** 首次记录时间 */
  private startTime: number = Date.now();
  /** 是否已订阅 globalEventBus */
  private trackingStarted = false;
  /** 订阅列表 */
  private subscriptions: EventSubscription[] = [];
  /** 待配对的起始时刻（起始事件类型 → 关联键 → 起始时刻 FIFO） */
  private pendingStarts: Map<string, Map<string, number[]>> = new Map();
  /** 可选的 OTelMetrics 实例 */
  private otelMetrics: IOTelMetricsPort | null = null;

  /**
   * 设置 OTel Metrics 实例（启用后将同时记录到 OTel）
   *
   * @param metrics OTelMetrics 实例
   */
  setOTelMetrics(metrics: IOTelMetricsPort): void {
    this.otelMetrics = metrics;
  }

  /**
   * 开始追踪：订阅所有编排事件
   */
  startTracking(): void {
    if (this.trackingStarted) return;

    // 订阅所有 OrchestrationEventType 值
    const eventValues = Object.values(OrchestrationEventType);
    for (const eventType of eventValues) {
      const sub = globalEventBus.on(eventType, (payload: unknown) => {
        this.handleOrchestrationEvent(eventType, payload);
      });
      this.subscriptions.push(sub);
    }

    this.trackingStarted = true;
  }

  /**
   * 停止追踪
   */
  stopTracking(): void {
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];
    this.trackingStarted = false;
  }

  /**
   * 处理单条编排事件：先尝试配对耗时，再累计计数
   *
   * @param eventType 事件类型
   * @param payload 事件载荷
   */
  private handleOrchestrationEvent(eventType: string, payload: unknown): void {
    const now = Date.now();

    const startEvent = END_TO_START_EVENT[eventType];
    if (startEvent) {
      const startedAt = this.takeStartTime(startEvent, payload);
      // 时钟回拨时 `now < startedAt` ⇒ 丢弃该样本（不记负数）
      if (startedAt !== undefined && now >= startedAt) {
        this.pushLatency(startEvent, now - startedAt);
      }
    }

    if (START_EVENTS.has(eventType)) {
      this.pushStartTime(eventType, payload, now);
    }

    this.recordEvent(eventType, undefined, payload);
  }

  /**
   * 登记一条起始时刻
   */
  private pushStartTime(
    startEvent: string,
    payload: unknown,
    at: number
  ): void {
    let buckets = this.pendingStarts.get(startEvent);
    if (!buckets) {
      buckets = new Map();
      this.pendingStarts.set(startEvent, buckets);
    }

    const key = extractPairKey(PAIR_KEY_FIELDS[startEvent], payload);
    let times = buckets.get(key);
    if (!times) {
      // 键空间上限：丢弃最早登记的键（Map 保序）
      if (buckets.size >= MAX_PENDING_KEYS) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey !== undefined) buckets.delete(oldestKey);
      }
      times = [];
      buckets.set(key, times);
    }

    times.push(at);
    if (times.length > MAX_PENDING_PER_KEY) {
      times.shift();
    }
  }

  /**
   * 取出与终止事件配对的起始时刻（FIFO）
   */
  private takeStartTime(
    startEvent: string,
    payload: unknown
  ): number | undefined {
    const buckets = this.pendingStarts.get(startEvent);
    if (!buckets || buckets.size === 0) return undefined;

    const key = extractPairKey(PAIR_KEY_FIELDS[startEvent], payload);
    const exact = this.shiftTime(buckets, key);
    if (exact !== undefined) return exact;

    // 两侧键不一致（终止载荷缺标识，或起始载荷缺标识落入 `''` 桶）：
    // 仅当该起始事件只有一个待配对桶时退化配对，避免跨会话错配。
    if (buckets.size === 1) {
      const onlyKey = buckets.keys().next().value;
      if (onlyKey !== undefined && onlyKey !== key) {
        return this.shiftTime(buckets, onlyKey);
      }
    }
    return undefined;
  }

  /**
   * 从指定桶取出最早一条起始时刻
   */
  private shiftTime(
    buckets: Map<string, number[]>,
    key: string
  ): number | undefined {
    const times = buckets.get(key);
    if (!times || times.length === 0) return undefined;
    const at = times.shift();
    if (times.length === 0) buckets.delete(key);
    return at;
  }

  /**
   * 记录链路耗时（挂在**起始事件**类型上，与 span 语义一致）
   *
   * 与 {@link recordEvent} 的区别：**不递增计数**（该事件已计数过），只追加延迟样本。
   */
  private pushLatency(eventType: string, latencyMs: number): void {
    if (latencyMs < 0) return;

    let entry = this.stats.get(eventType);
    if (!entry) {
      entry = { count: 0, latencies: [] };
      this.stats.set(eventType, entry);
    }
    entry.latencies.push(latencyMs);
    if (entry.latencies.length > SLIDING_WINDOW_SIZE) {
      entry.latencies.shift();
    }

    this.otelMetrics?.recordHistogram('orch.events.latency', latencyMs, {
      event_type: eventType,
    });
  }

  /**
   * 记录一条事件（含延迟统计和维度提取）
   *
   * @param eventType 事件类型
   * @param latencyMs 延迟（毫秒，可选）
   * @param payload 事件 payload（可选，用于提取角色/类别等维度）
   */
  recordEvent(eventType: string, latencyMs?: number, payload?: unknown): void {
    let entry = this.stats.get(eventType);
    if (!entry) {
      entry = { count: 0, latencies: [] };
      this.stats.set(eventType, entry);
    }

    entry.count++;

    if (latencyMs !== undefined && latencyMs >= 0) {
      entry.latencies.push(latencyMs);
      if (entry.latencies.length > SLIDING_WINDOW_SIZE) {
        entry.latencies.shift();
      }
    }

    // 提取维度并聚合
    const dims = extractDimensions(eventType, payload);
    if (dims.agentRole) {
      this.roleCounts.set(
        dims.agentRole,
        (this.roleCounts.get(dims.agentRole) ?? 0) + 1
      );
    }
    if (dims.category) {
      this.categoryCounts.set(
        dims.category,
        (this.categoryCounts.get(dims.category) ?? 0) + 1
      );
    }

    // P1-2.7: 错误事件独立统计
    const status = extractStatus(payload);
    if (status === 'error' || status === 'failed') {
      const errorKey = `${dims.category || 'unknown'}:${dims.agentRole || 'unknown'}`;
      this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) ?? 0) + 1);

      if (this.otelMetrics) {
        this.otelMetrics.incrementCounter('orch.events.errors', 1, {
          category: dims.category || 'unknown',
          agent_role: dims.agentRole || 'unknown',
          event_type: eventType,
        });
      }
    }

    // 如果配置了 OTel Metrics，同步记录多维指标
    if (this.otelMetrics) {
      const otelAttrs: Record<string, string | number | boolean> = {
        event_type: eventType,
      };
      if (dims.agentRole) otelAttrs.agent_role = dims.agentRole;
      if (dims.category) otelAttrs.category = dims.category;

      this.otelMetrics.incrementCounter('orch.events.total', 1, otelAttrs);
      if (latencyMs !== undefined && latencyMs >= 0) {
        this.otelMetrics.recordHistogram(
          'orch.events.latency',
          latencyMs,
          otelAttrs
        );
      }
    }
  }

  /**
   * 获取统计快照（含多维聚合）
   *
   * @returns 当前统计快照
   */
  getStats(): MetricsSnapshot {
    const events: EventStatSnapshot[] = [];

    for (const [eventType, entry] of this.stats) {
      const sorted = entry.latencies.slice().sort((a, b) => a - b);
      const len = sorted.length;
      const p50 = len > 0 ? sorted[Math.floor(len * 0.5)] : 0;
      const p95 = len > 0 ? sorted[Math.floor(len * 0.95)] : 0;
      const avg = len > 0 ? sorted.reduce((sum, v) => sum + v, 0) / len : 0;

      events.push({ eventType, count: entry.count, p50, p95, avg });
    }

    // 按事件类型排序
    events.sort((a, b) => a.eventType.localeCompare(b.eventType));

    const totalEvents = Array.from(this.stats.values()).reduce(
      (sum, entry) => sum + entry.count,
      0
    );

    // 构建多维聚合结果
    const byRole: Record<string, number> = {};
    for (const [role, count] of this.roleCounts) {
      byRole[role] = count;
    }

    const byCategory: Record<string, number> = {};
    for (const [category, count] of this.categoryCounts) {
      byCategory[category] = count;
    }

    return {
      events,
      totalEvents,
      startTime: this.startTime,
      timestamp: Date.now(),
      byRole,
      byCategory,
    };
  }

  /**
   * 获取指定事件类型的统计
   *
   * @param eventType 事件类型
   * @returns 统计快照，若不存在返回 null
   */
  getEventStats(eventType: string): EventStatSnapshot | null {
    const entry = this.stats.get(eventType);
    if (!entry) return null;

    const sorted = entry.latencies.slice().sort((a, b) => a - b);
    const len = sorted.length;

    return {
      eventType,
      count: entry.count,
      p50: len > 0 ? sorted[Math.floor(len * 0.5)] : 0,
      p95: len > 0 ? sorted[Math.floor(len * 0.95)] : 0,
      avg: len > 0 ? sorted.reduce((sum, v) => sum + v, 0) / len : 0,
    };
  }

  /**
   * 重置所有统计数据
   */
  reset(): void {
    this.stats.clear();
    this.pendingStarts.clear();
    this.startTime = Date.now();
  }
}

/**
 * 全局 OrchestrationMetrics 实例
 */
let orchestrationMetrics: OrchestrationMetrics | null = null;

/**
 * 获取全局 OrchestrationMetrics 实例（单例）
 *
 * @returns OrchestrationMetrics 实例
 */
export function getOrchestrationMetrics(): OrchestrationMetrics {
  if (!orchestrationMetrics) {
    orchestrationMetrics = new OrchestrationMetrics();
    orchestrationMetrics.startTracking();
  }
  return orchestrationMetrics;
}

/**
 * 创建 OrchestrationMetrics 实例（不自动启动，用于测试）
 *
 * @returns OrchestrationMetrics 实例
 */
export function createOrchestrationMetrics(): OrchestrationMetrics {
  return new OrchestrationMetrics();
}
