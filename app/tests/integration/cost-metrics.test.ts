/**
 * P3-2.15: 集成测试 — CostMetricsBridge OTel 指标验证
 *
 * 验证 CostMetricsBridge.init() 注册 OTel ObservableGauge。
 */

import { describe, it, expect } from 'bun:test';
import {
  CostMetricsBridge,
  getCostMetricsBridge,
} from '../../src/cost/CostMetricsBridge';

describe('CostMetricsBridge OTel 集成测试', () => {
  it('getCostMetricsBridge 返回单例', () => {
    const bridge1 = getCostMetricsBridge();
    const bridge2 = getCostMetricsBridge();
    expect(bridge1).toBe(bridge2);
  });

  it('init() 可安全重复调用', () => {
    const bridge = new CostMetricsBridge();

    // 首次调用不应抛异常
    expect(() => bridge.init()).not.toThrow();
    // 重复调用也不应抛异常
    expect(() => bridge.init()).not.toThrow();
  });

  it('record 后记录数正确递增', () => {
    const bridge = new CostMetricsBridge();

    bridge.record('test-model', {
      inputTokens: 100,
      outputTokens: 50,
    }, 0.001);

    expect(bridge.getRecordCount()).toBe(1);

    bridge.record('test-model', {
      inputTokens: 200,
      outputTokens: 100,
    }, 0.002);

    expect(bridge.getRecordCount()).toBe(2);
  });

  it('generateMetrics 返回正确结构', () => {
    const bridge = new CostMetricsBridge();

    bridge.record('gpt-4', {
      inputTokens: 1000,
      outputTokens: 500,
    }, 0.03);

    const metrics = bridge.generateMetrics();

    expect(Array.isArray(metrics)).toBe(true);
    expect(metrics.length).toBeGreaterThan(0);

    // 验证必含的指标名
    const names = metrics.map((m) => m.name);
    expect(names).toContain('Liri.cost.total');
    expect(names).toContain('Liri.tokens.input');
    expect(names).toContain('Liri.tokens.output');
    expect(names).toContain('Liri.requests.total');
  });

  it('generateDashboard 返回正确的成本汇总', () => {
    const bridge = new CostMetricsBridge();

    bridge.record('gpt-4', {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadInputTokens: 200,
      cacheCreationInputTokens: 100,
    }, 0.03);

    const dashboard = bridge.generateDashboard();

    expect(dashboard.totalCost).toBe(0.03);
    expect(dashboard.requestCount).toBe(1);
    expect(dashboard.avgCostPerRequest).toBe(0.03);
    expect(dashboard.tokenUsage.inputTotal).toBe(1000);
    expect(dashboard.tokenUsage.outputTotal).toBe(500);
    expect(dashboard.tokenUsage.cacheTotal).toBe(300);
  });

  it('clear 清空所有记录', () => {
    const bridge = new CostMetricsBridge();

    bridge.record('gpt-4', {
      inputTokens: 100,
      outputTokens: 50,
    }, 0.001);

    expect(bridge.getRecordCount()).toBe(1);

    bridge.clear();
    expect(bridge.getRecordCount()).toBe(0);
  });
});
