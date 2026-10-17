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
