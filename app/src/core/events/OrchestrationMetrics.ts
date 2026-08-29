/**
 * 编排指标统计
 *
 * 挂在 globalEventBus 上作为中间件，订阅所有 Orchestration 事件，
 * 统计事件频率和延迟分布，提供后端可观测性。
 *
 * 通过 getStats() 获取 P50/P95 延迟分位数，
 * 可选对接 OTel Metrics（通过 OTelMetrics 实例）。
 */

import { OrchestrationEventType } from '@modules/agent';
import { globalEventBus, type EventSubscription } from './EventBus';
import type { OTelMetrics } from '@modules/monitoring/otel/OTelMetrics';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('core:events:OrchestrationMetrics');

/** 滑动窗口大小（记录最近 N 条延迟） */
const SLIDING_WINDOW_SIZE = 100;

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
  /** 可选的 OTelMetrics 实例 */
  private otelMetrics: OTelMetrics | null = null;

  /**
   * 设置 OTel Metrics 实例（启用后将同时记录到 OTel）
   *
   * @param metrics OTelMetrics 实例
   */
  setOTelMetrics(metrics: OTelMetrics): void {
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
        this.recordEvent(eventType, undefined, payload);
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
