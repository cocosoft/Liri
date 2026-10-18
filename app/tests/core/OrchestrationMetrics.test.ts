// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 编排指标耗时派生测试（T-13-b，2026-10-17）
//
// 修复前：`startTracking()` 只传 `recordEvent(eventType, undefined, payload)`，
// 全仓无调用方注入 `latencyMs` ⇒ `latencies` 恒空 ⇒ P50/P95 恒 0。
// 修复后：订阅端按「起始事件 → 终止事件」配对派生耗时，挂在**起始事件**类型上。
//
// 断言手段：`IOTelMetricsPort.recordHistogram` 是现成的注入端口，用它统计
// `orch.events.latency` 的样本条数与数值，避免依赖不可观测的私有状态。

import { afterEach, describe, expect, it } from 'bun:test';
import {
  createOrchestrationMetrics,
  type OrchestrationMetrics,
} from '../../src/core/events/OrchestrationMetrics.js';
import { globalEventBus } from '../../src/core/events/EventBus.js';
import { OrchestrationEventPairer } from '../../src/core/events/orchestrationPairing.js';
import { OrchestrationEventType as E } from '@modules/types/orchestrationEvents';

interface LatencySample {
  name: string;
  value: number;
  eventType?: string;
}

let metrics: OrchestrationMetrics | null = null;
let samples: LatencySample[] = [];

/** 启动一个独立的追踪实例，并注入只收集延迟直方图的 OTel 端口 */
function startTracking(): OrchestrationMetrics {
  samples = [];
  metrics = createOrchestrationMetrics();
  metrics.setOTelMetrics({
    incrementCounter: () => {},
    recordHistogram: (name, value, attributes) => {
      if (name !== 'orch.events.latency') return;
      const eventType = attributes?.event_type;
      samples.push({
        name,
        value,
        eventType: typeof eventType === 'string' ? eventType : undefined,
      });
    },
  });
  metrics.startTracking();
  return metrics;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  metrics?.stopTracking();
  metrics?.reset();
  metrics = null;
  samples = [];
});

describe('OrchestrationMetrics 耗时派生（T-13-b）', () => {
  it('PLAN_START → PLAN_COMPLETED：耗时记在起始事件上', async () => {
    const m = startTracking();

    globalEventBus.publish(E.PLAN_START, { planId: 'p1', totalSteps: 2 });
    await sleep(40);
    globalEventBus.publish(E.PLAN_COMPLETED, { planId: 'p1', status: 'done' });

    expect(samples).toHaveLength(1);
    expect(samples[0].eventType).toBe(E.PLAN_START);
    expect(samples[0].value).toBeGreaterThanOrEqual(30);

    // 起始事件：count 与 p50 都成立；终止事件只计数、不挂耗时
    const startStats = m.getEventStats(E.PLAN_START);
    expect(startStats?.count).toBe(1);
    expect(startStats?.p50).toBeGreaterThanOrEqual(30);
    const endStats = m.getEventStats(E.PLAN_COMPLETED);
    expect(endStats?.count).toBe(1);
    expect(endStats?.p50).toBe(0);
  });

  it('按关联键配对：未终结的计划不会抢占另一计划的耗时刻', async () => {
    startTracking();

    // p1 只开始不结束；随后 p2 开始并立刻结束
    globalEventBus.publish(E.PLAN_START, { planId: 'p1' });
    await sleep(100);
    globalEventBus.publish(E.PLAN_START, { planId: 'p2' });
    globalEventBus.publish(E.PLAN_COMPLETED, { planId: 'p2' });

    expect(samples).toHaveLength(1);
    // 若退化为「全局 FIFO」，会取到 p1 的起始时刻（≥100ms）
    expect(samples[0].value).toBeLessThan(50);
  });

  it('同键多次起始按 FIFO 配对（嵌套/重入）', async () => {
    startTracking();

    globalEventBus.publish(E.PLAN_START, { planId: 'p1' });
    await sleep(60);
    globalEventBus.publish(E.PLAN_START, { planId: 'p1' });
    await sleep(60);
    globalEventBus.publish(E.PLAN_COMPLETED, { planId: 'p1' });
    globalEventBus.publish(E.PLAN_COMPLETED, { planId: 'p1' });

    expect(samples).toHaveLength(2);
    // 先结束的先配最早一条起始 ⇒ 第一条样本（≈120ms）明显大于第二条（≈60ms）
    expect(samples[0].value).toBeGreaterThan(samples[1].value + 30);
  });

  it('孤立终止事件不产生耗时样本（不伪造）', () => {
    const m = startTracking();

    globalEventBus.publish(E.CHAIN_END, { chainId: 'c1', status: 'completed' });

    expect(samples).toHaveLength(0);
    expect(m.getEventStats(E.CHAIN_END)?.count).toBe(1);
  });

  it('reset 清空待配对起始时刻', async () => {
    const m = startTracking();

    globalEventBus.publish(E.PLAN_START, { planId: 'p1' });
    await sleep(20);
    m.reset();
    globalEventBus.publish(E.PLAN_COMPLETED, { planId: 'p1' });

    expect(samples).toHaveLength(0);
  });
});

describe('OrchestrationMetrics 业务类别派生（H-2-R1）', () => {
  it('按真实词表 `orch:<category>:` 派生 byCategory（不再恒空）', () => {
    const m = startTracking();

    globalEventBus.publish(E.PLAN_START, { planId: 'p1' });
    globalEventBus.publish(E.COUNCIL_START, { sessionId: 's1' });
    globalEventBus.publish(E.ORCH_START, { workItemId: 'w1' });
    globalEventBus.publish(E.TOKEN_USAGE, { totalTokens: 1 });

    expect(m.getStats().byCategory).toEqual({
      plan: 1,
      council: 1,
      orchestration: 1,
      token: 1,
    });
  });

  it('byRole 按 agentRole 聚合（H-2-R4）', () => {
    const m = startTracking();

    globalEventBus.publish(E.COUNCIL_AGENT_SPEAKING, {
      sessionId: 's1',
      agentId: 'architect',
      agentName: 'Architect',
      agentRole: 'architect',
      round: 1,
    });
    globalEventBus.publish(E.COUNCIL_AGENT_SPEAKING, {
      sessionId: 's1',
      agentId: 'security',
      agentName: 'Security',
      agentRole: 'security',
      round: 1,
    });

    expect(m.getStats().byRole).toEqual({ architect: 1, security: 1 });
  });
});

/**
 * H-2-R8（2026-10-18）：**全量配对表**守卫。
 *
 * `orchestrationPairing.ts` 的映射表覆盖 12 组起止；此前只有 PLAN 有行为用例。
 * 本组对每组都发一次真实事件（含无生产者的 DAG/Chain/Swarm/Rule/Parallel），
 * 验证「起始事件 → 终止事件」确实产出耗时样本 —— 将来接线后无需再补指标测试。
 */
describe('OrchestrationMetrics 全量配对表（H-2-R8）', () => {
  const CASES: Array<{
    name: string;
    start: string;
    startPayload: Record<string, unknown>;
    end: string;
    endPayload: Record<string, unknown>;
  }> = [
    {
      name: 'DAG ORCH',
      start: E.ORCH_START,
      startPayload: { workItemId: 'w1' },
      end: E.ORCH_END,
      endPayload: { workItemId: 'w1' },
    },
    {
      name: 'DAG TASK',
      start: E.ORCH_TASK_START,
      startPayload: { taskId: 't1' },
      end: E.ORCH_TASK_END,
      endPayload: { taskId: 't1' },
    },
    {
      name: 'DAG STEP',
      start: E.ORCH_STEP_START,
      startPayload: { taskId: 't1', stepName: 's1' },
      end: E.ORCH_STEP_COMPLETED,
      endPayload: { taskId: 't1', stepName: 's1' },
    },
    {
      name: 'PLAN',
      start: E.PLAN_START,
      startPayload: { planId: 'p1' },
      end: E.PLAN_COMPLETED,
      endPayload: { planId: 'p1' },
    },
    {
      name: 'PLAN STEP',
      start: E.PLAN_STEP_START,
      startPayload: { planId: 'p1', stepIndex: 0 },
      end: E.PLAN_STEP_COMPLETED,
      endPayload: { planId: 'p1', stepIndex: 0 },
    },
    {
      name: 'CHAIN',
      start: E.CHAIN_START,
      startPayload: { chainId: 'c1' },
      end: E.CHAIN_END,
      endPayload: { chainId: 'c1' },
    },
    {
      name: 'COUNCIL',
      start: E.COUNCIL_START,
      startPayload: { sessionId: 's1' },
      end: E.COUNCIL_END,
      endPayload: { sessionId: 's1' },
    },
    {
      name: 'SWARM',
      start: E.SWARM_DISPATCH,
      startPayload: {},
      end: E.SWARM_COMPLETE,
      endPayload: {},
    },
    {
      name: 'RULE PASS',
      start: E.RULE_CHECK_START,
      startPayload: { ruleId: 'r1', filePath: 'a.ts' },
      end: E.RULE_CHECK_PASS,
      endPayload: { ruleId: 'r1', filePath: 'a.ts' },
    },
    {
      name: 'RULE FAIL',
      start: E.RULE_CHECK_START,
      startPayload: { ruleId: 'r2', filePath: 'b.ts' },
      end: E.RULE_CHECK_FAIL,
      endPayload: { ruleId: 'r2', filePath: 'b.ts' },
    },
    {
      name: 'PARALLEL',
      start: E.PARALLEL_START,
      startPayload: { agentId: 'batch-parallel' },
      end: E.PARALLEL_END,
      endPayload: { agentId: 'batch-parallel' },
    },
  ];

  for (const testCase of CASES) {
    it(`${testCase.name}：${testCase.start} → ${testCase.end} 产出耗时`, async () => {
      const m = startTracking();

      globalEventBus.publish(testCase.start, testCase.startPayload);
      await sleep(15);
      globalEventBus.publish(testCase.end, testCase.endPayload);

      const sample = samples.find((s) => s.eventType === testCase.start);
      expect(sample).toBeDefined();
      expect(sample!.value).toBeGreaterThanOrEqual(5);
      expect(m.getEventStats(testCase.start)?.p50).toBeGreaterThanOrEqual(5);
    });
  }

  it('DAG 错误终止同样回填起始事件耗时（ORCH_ERROR）', async () => {
    const m = startTracking();

    globalEventBus.publish(E.ORCH_START, { workItemId: 'w2' });
    await sleep(15);
    globalEventBus.publish(E.ORCH_ERROR, { workItemId: 'w2' });

    expect(samples.find((s) => s.eventType === E.ORCH_START)).toBeDefined();
    expect(m.getEventStats(E.ORCH_START)?.p50).toBeGreaterThanOrEqual(5);
  });

  it('PARALLEL（H-2-R11）：按 agentId 配对，未闭合批次不跨批次错配', () => {
    const pairer = new OrchestrationEventPairer();
    // 批次 A 未闭合（模拟中断 / 超时），批次 B 后开始并正常结束
    expect(
      pairer.push(E.PARALLEL_START, { agentId: 'batch-a' }, 1_000)
    ).toBeNull();
    expect(
      pairer.push(E.PARALLEL_START, { agentId: 'batch-b' }, 2_000)
    ).toBeNull();
    // 修复前（无键 FIFO）会把 A 的起始时刻配给 B 的 end ⇒ 83 分钟假样本
    expect(pairer.push(E.PARALLEL_END, { agentId: 'batch-b' }, 5_000)).toEqual({
      startEvent: E.PARALLEL_START,
      latencyMs: 3_000,
    });
    // 旧事件（无 agentId）仍走退化单桶，向后兼容
    pairer.push(E.PARALLEL_START, { totalTasks: 1 }, 10_000);
    expect(pairer.push(E.PARALLEL_END, { completedTasks: 1 }, 10_011)).toEqual({
      startEvent: E.PARALLEL_START,
      latencyMs: 11,
    });
  });
});
