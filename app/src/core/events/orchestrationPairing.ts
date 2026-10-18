/**
 * 编排事件的**起止配对**（纯逻辑，零 I/O）—— H-2（2026-10-18）
 *
 * 为什么独立成模块：
 * - 运行时 `OrchestrationMetrics` 需要**流式**配对（事件到达即算耗时）；
 * - 离线分析（`scripts/analyze-orchestration-events.ts`）需要按同一口径重放**持久化事件**；
 * - 两条路径若各写一份配对表/键规则 ⇒ 口径漂移（CS01）。本模块是唯一实现。
 *
 * 口径（与 T-13-b 一致）：
 * - 终止事件到达时按关联键取出最早的一条起始时刻（FIFO，支持并发/嵌套）；
 * - 载荷缺键或两侧键不一致时，仅当该起始事件**只有一个待配对桶**才退化配对；
 * - 时钟回拨（`at < startedAt`）⇒ 丢弃该样本（不记负数）。
 */

import { OrchestrationEventType } from '@modules/types/orchestrationEvents';

/** 单个关联键最多保留的待配对起始时刻（超出丢弃最旧，防无终态事件导致无界增长） */
const MAX_PENDING_PER_KEY = 32;

/** 单个起始事件类型最多保留的关联键数（同上，防止键空间无界增长） */
const MAX_PENDING_KEYS = 256;

/**
 * 终止事件 → 起始事件（耗时配对表）
 *
 * 与 `EventBusOTelBridge.END_EVENT_TO_START` 同源，并补齐其未覆盖的
 * PLAN / CHAIN / PARALLEL / STEP 链路（指标口径需要全链路覆盖）。
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
 * 未列出的起始事件（`SWARM_DISPATCH`）载荷无稳定标识 ⇒ 单桶 FIFO。
 *
 * `PARALLEL_START`（H-2-R11，2026-10-18）：载荷带 `agentId`（批次唯一标识）⇒ 按批次配对。
 * 修复前无键 ⇒ 离线日志重放时，同一会话的多次批次（尤其**未闭合**的旧批次）会按 FIFO
 * 跨批次错配（实测：10:58 的未闭合批次吞掉了 12:26 批次的 `end`，产出 88 分钟假样本）。
 * 旧事件缺 `agentId` ⇒ 键为 `''`，仍走退化单桶（向后兼容）。
 */
const PAIR_KEY_FIELDS: Record<string, readonly string[]> = {
  [OrchestrationEventType.ORCH_START]: ['workItemId'],
  [OrchestrationEventType.ORCH_TASK_START]: ['taskId'],
  [OrchestrationEventType.ORCH_STEP_START]: ['taskId', 'stepName'],
  [OrchestrationEventType.PLAN_START]: ['planId'],
  [OrchestrationEventType.PLAN_STEP_START]: ['planId', 'stepIndex'],
  [OrchestrationEventType.CHAIN_START]: ['chainId'],
  [OrchestrationEventType.COUNCIL_START]: ['sessionId'],
  [OrchestrationEventType.PARALLEL_START]: ['agentId'],
  [OrchestrationEventType.RULE_CHECK_START]: ['ruleId', 'filePath'],
};

/**
 * 从载荷提取关联键
 *
 * @returns 各字段值拼接的键；任一字段缺失或载荷非对象 ⇒ `''`（退化单桶）
 */
export function extractOrchestrationPairKey(
  startEvent: string,
  payload: unknown
): string {
  const fields = PAIR_KEY_FIELDS[startEvent];
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

/** 一次成功配对的结果 */
export interface OrchestrationPairResult {
  /** 起始事件类型（耗时挂在该类型上，与 span 语义一致） */
  startEvent: string;
  /** 起 → 止的墙钟耗时（毫秒，恒 ≥ 0） */
  latencyMs: number;
}

/**
 * 编排事件起止配对器（流式；运行时与离线分析共用）
 *
 * 用法：对每条事件按时间顺序调用 {@link push}；
 * 返回 `null` 表示该事件未形成配对，否则返回起始事件类型与耗时。
 */
export class OrchestrationEventPairer {
  /** 待配对的起始时刻（起始事件类型 → 关联键 → 起始时刻 FIFO） */
  private pendingStarts: Map<string, Map<string, number[]>> = new Map();

  /**
   * 处理一条事件
   *
   * @param eventType 事件类型（真实词表，如 `orch:plan:start`）
   * @param payload 事件载荷（用于取关联键）
   * @param at 事件时刻（epoch ms）
   */
  push(
    eventType: string,
    payload: unknown,
    at: number
  ): OrchestrationPairResult | null {
    let result: OrchestrationPairResult | null = null;

    const startEvent = END_TO_START_EVENT[eventType];
    if (startEvent) {
      const startedAt = this.takeStartTime(startEvent, payload);
      // 时钟回拨时 `at < startedAt` ⇒ 丢弃该样本（不记负数）
      if (startedAt !== undefined && at >= startedAt) {
        result = { startEvent, latencyMs: at - startedAt };
      }
    }

    if (START_EVENTS.has(eventType)) {
      this.pushStartTime(eventType, payload, at);
    }

    return result;
  }

  /** 清空全部待配对起始时刻（`reset` / 测试复位） */
  reset(): void {
    this.pendingStarts.clear();
  }

  /** 登记一条起始时刻 */
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

    const key = extractOrchestrationPairKey(startEvent, payload);
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

  /** 取出与终止事件配对的起始时刻（FIFO） */
  private takeStartTime(
    startEvent: string,
    payload: unknown
  ): number | undefined {
    const buckets = this.pendingStarts.get(startEvent);
    if (!buckets || buckets.size === 0) return undefined;

    const key = extractOrchestrationPairKey(startEvent, payload);
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

  /** 从指定桶取出最早一条起始时刻 */
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
}
