/**
 * EventBus ↔ OTel Span 桥接
 *
 * 将 EventBus 上的编排事件自动映射为 OTel Span，
 * 使 Jaeger/Zipkin 中可见完整的调用树。
 *
 * 事件到 Span 的映射规则：
 * - `:start` 后缀事件 → 创建新 Span
 * - `:end` / `:error` / `:complete` 后缀事件 → 结束对应 Span
 * - 其他事件（如 `:progress`、`:round`）→ 记录为 Span 事件
 *
 * Span 深度控制：maxDepth=4，超过上限的子树折叠为单个 Span。
 */

import { Span, SpanStatusCode } from '@opentelemetry/api';
import { OrchestrationEventType } from '@modules/agent';
import { globalEventBus } from './EventBus';
import { getOTelTracing } from '@modules/monitoring';
import {
  isSpanCovered,
  markSpanCovered,
} from '@modules/monitoring/tracing/SpanCoverageRegistry';

/** Span 映射配置 */
interface SpanMapping {
  /** Span 名称 */
  spanName: string;
  /** 父事件类型（用于建立父子 Span 关系） */
  parentEvent?: string;
}

/** 事件 → Span 映射（仅 start 型事件） */
const START_EVENT_SPAN_MAP: Record<string, SpanMapping> = {
  [OrchestrationEventType.ORCH_START]: { spanName: 'dag.execute' },
  [OrchestrationEventType.ORCH_TASK_START]: {
    spanName: 'dag.task',
    parentEvent: OrchestrationEventType.ORCH_START,
  },
  [OrchestrationEventType.COUNCIL_START]: { spanName: 'council.debate' },
  [OrchestrationEventType.COUNCIL_ROUND]: {
    spanName: 'council.round',
    parentEvent: OrchestrationEventType.COUNCIL_START,
  },
  [OrchestrationEventType.SWARM_DISPATCH]: { spanName: 'swarm.dispatch' },
  [OrchestrationEventType.RULE_CHECK_START]: {
    spanName: 'rule.check',
    parentEvent: OrchestrationEventType.ORCH_START,
  },
  [OrchestrationEventType.CONTEXT_LAYER_LOAD]: {
    spanName: 'context.layer',
    parentEvent: OrchestrationEventType.ORCH_START,
  },
};

/** end 事件 → 对应的 start 事件（用于查找要结束的 Span） */
const END_EVENT_TO_START: Record<string, string> = {
  [OrchestrationEventType.ORCH_END]: OrchestrationEventType.ORCH_START,
  [OrchestrationEventType.ORCH_TASK_END]:
    OrchestrationEventType.ORCH_TASK_START,
  [OrchestrationEventType.ORCH_ERROR]: OrchestrationEventType.ORCH_START,
  [OrchestrationEventType.COUNCIL_END]: OrchestrationEventType.COUNCIL_START,
  [OrchestrationEventType.SWARM_COMPLETE]:
    OrchestrationEventType.SWARM_DISPATCH,
  [OrchestrationEventType.RULE_CHECK_PASS]:
    OrchestrationEventType.RULE_CHECK_START,
  [OrchestrationEventType.RULE_CHECK_FAIL]:
    OrchestrationEventType.RULE_CHECK_START,
};

/** Progress 类事件（记录为 Span 事件而非创建/结束 Span） */
const PROGRESS_EVENTS = new Set<string>([
  OrchestrationEventType.ORCH_TASK_PROGRESS,
  OrchestrationEventType.RULE_CHECK_PROGRESS,
  OrchestrationEventType.COUNCIL_DETAIL,
  OrchestrationEventType.CONTEXT_RULE_INJECT,
  OrchestrationEventType.SWARM_AGENT_STATUS,
]);

/** 活跃 Span 追踪（startEventType → { span, depth }） */
const activeSpanMap = new Map<string, { span: Span; depth: number }>();

/** 最大 Span 嵌套深度 */
const MAX_SPAN_DEPTH = 4;

/**
 * 初始化 EventBus ↔ OTel Span 桥接
 *
 * 订阅编排事件，自动将编排事件映射为 OTel Span。
 * 应在应用启动时调用一次。
 */
export function initEventBusOTelBridge(): void {
  // 订阅所有 Start 型事件
  for (const eventType of Object.keys(START_EVENT_SPAN_MAP)) {
    const config = START_EVENT_SPAN_MAP[eventType];
    globalEventBus.on(eventType, (payload: unknown) => {
      startSpanForEvent(eventType, config, payload);
    });
  }

  // 订阅所有 End 型事件
  for (const [endEvent, startEvent] of Object.entries(END_EVENT_TO_START)) {
    globalEventBus.on(endEvent, (payload: unknown) => {
      endSpanForEvent(startEvent, endEvent, payload);
    });
  }

  // 订阅所有 Progress 型事件
  for (const eventType of PROGRESS_EVENTS) {
    globalEventBus.on(eventType, (payload: unknown) => {
      recordSpanEvent(eventType, payload);
    });
  }
}

/**
 * 为 start 事件创建 Span
 */
function startSpanForEvent(
  eventType: string,
  config: SpanMapping,
  payload: unknown
): void {
  // 深度检查：超过 maxDepth 则不创建子 Span
  const parentDepth = config.parentEvent
    ? (activeSpanMap.get(config.parentEvent)?.depth ?? 0)
    : 0;

  if (parentDepth >= MAX_SPAN_DEPTH) {
    return; // 超过最大深度，折叠子树
  }

  // 查找父 Span
  let parentSpan: Span | undefined;
  if (config.parentEvent) {
    parentSpan = activeSpanMap.get(config.parentEvent)?.span;
  }

  // P2-2.9: 去重检查 — 避免与 SessionTracing 创建重复 Span
  if (parentSpan && isSpanCovered(parentSpan, config.spanName)) {
    return;
  }

  const attributes = toSpanAttributes(payload);
  const otel = getOTelTracing();
  const span = otel.startSpan(config.spanName, attributes, parentSpan);

  // 标记 Span 已创建（后续同名 Span 将被去重）
  if (parentSpan) {
    markSpanCovered(parentSpan, config.spanName);
  }

  activeSpanMap.set(eventType, { span, depth: parentDepth + 1 });
}

/**
 * 为 end 事件结束对应的 Span
 */
function endSpanForEvent(
  startEvent: string,
  endEvent: string,
  payload: unknown
): void {
  const entry = activeSpanMap.get(startEvent);
  if (!entry) return;

  const { span } = entry;

  // 判断是否为错误事件
  const isError = endEvent.endsWith(':error') || endEvent.endsWith(':fail');
  if (isError) {
    const errorMsg =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as Record<string, unknown>).error)
        : `Event ${endEvent} completed with error`;
    span.setStatus({ code: SpanStatusCode.ERROR, message: errorMsg });
  }

  const otel = getOTelTracing();
  otel.endSpan(span);
  activeSpanMap.delete(startEvent);
}

/**
 * 为 Progress 事件记录到当前活跃的父 Span
 */
function recordSpanEvent(eventType: string, payload: unknown): void {
  // 找到最匹配的父级 start 事件
  const parentStartEvent = findParentStartEvent(eventType);
  if (!parentStartEvent) return;

  const entry = activeSpanMap.get(parentStartEvent);
  if (!entry) return;

  const attributes = toSpanAttributes(payload);
  entry.span.addEvent(eventType, attributes);
}

/**
 * 查找 Progress 事件对应的父 Start 事件
 */
function findParentStartEvent(progressEvent: string): string | undefined {
  // 尝试直接从 END_EVENT_TO_START 中查找
  for (const [startKey] of activeSpanMap) {
    if (progressEvent.startsWith(startKey.replace(/:start$/, ''))) {
      return startKey;
    }
  }
  return undefined;
}

/**
 * 将事件 payload 转换为 Span attributes
 */
function toSpanAttributes(
  payload: unknown
): Record<string, string | number | boolean> | undefined {
  if (!payload || typeof payload !== 'object') return undefined;

  const attrs: Record<string, string | number | boolean> = {};
  const obj = payload as Record<string, unknown>;

  // 提取常用标量字段
  for (const key of [
    'taskId',
    'taskName',
    'workItemId',
    'round',
    'agentId',
    'agentName',
    'status',
    'progress',
    'success',
    'durationMs',
    'layer',
    'ruleId',
    'ruleName',
  ]) {
    if (key in obj) {
      const val = obj[key];
      if (
        typeof val === 'string' ||
        typeof val === 'number' ||
        typeof val === 'boolean'
      ) {
        attrs[key] = val;
      }
    }
  }

  return Object.keys(attrs).length > 0 ? attrs : undefined;
}

/**
 * 获取当前活跃的 Span 统计信息（调试/可观测用）
 */
export function getOTelBridgeStats(): {
  activeSpans: number;
  maxDepth: number;
} {
  let maxDepth = 0;
  for (const entry of activeSpanMap.values()) {
    maxDepth = Math.max(maxDepth, entry.depth);
  }
  return {
    activeSpans: activeSpanMap.size,
    maxDepth,
  };
}

/**
 * 清理所有活跃 Span（用于测试或重置）
 */
export function resetOTelBridge(): void {
  for (const { span } of activeSpanMap.values()) {
    try {
      span.end();
    } catch (err) {
      /* ignore */
    }
  }
  activeSpanMap.clear();
}
