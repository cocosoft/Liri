// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * S2-6（2026-10-11）—— 工具调用可观测性指标（`tools/monitoring/ToolMetrics`）。
 *
 * 覆盖：
 *  - ① 统一调用指标：按 `ok|error` 分维计数、耗时 / 入参字节 / 估算 tokens 直方图；
 *  - ② Tool-Use Context Entropy：schema tokens 直方图 + 占上下文窗口比例 gauge；
 *  - 缺省字段不记录（不臆造，CS06）。
 *
 * 读回口径：`getMetricsService().getMetric(name, labels)`（键含排序后的标签）。
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { getMetricsService } from '@modules/monitoring';
import {
  SCHEMA_ENTROPY_PERCENT_THRESHOLD,
  SCHEMA_ENTROPY_TURN_THRESHOLD,
  evaluateSchemaEntropyGate,
  recordToolInvocation,
  recordToolSchemaEntropy,
  resetToolMetricsForTest,
} from '../../src/tools/monitoring/ToolMetrics.js';

const svc = getMetricsService();

beforeEach(() => {
  resetToolMetricsForTest();
});

describe('S2-6 工具调用统一指标', () => {
  it('按 `ok|error` 分维计数；耗时/入参字节/估算 tokens 如实累计', () => {
    recordToolInvocation({
      toolName: 'bash',
      durationMs: 12,
      success: true,
      inputBytes: 20,
      estimatedTokens: 5,
    });
    recordToolInvocation({
      toolName: 'bash',
      durationMs: 30,
      success: false,
      inputBytes: 10,
      estimatedTokens: 3,
    });

    expect(
      svc
        .getMetric('tools.invocation.total', {
          module: 'tools',
          tool: 'bash',
          result: 'ok',
        })
        ?.get()
    ).toBe(1);
    expect(
      svc
        .getMetric('tools.invocation.total', {
          module: 'tools',
          tool: 'bash',
          result: 'error',
        })
        ?.get()
    ).toBe(1);

    const dur = svc
      .getMetric('tools.invocation.duration_ms', {
        module: 'tools',
        tool: 'bash',
      })
      ?.get();
    expect(dur.count).toBe(2);
    expect(dur.sum).toBe(42);

    const bytes = svc
      .getMetric('tools.invocation.input_bytes', {
        module: 'tools',
        tool: 'bash',
      })
      ?.get();
    expect(bytes.sum).toBe(30);

    const tokens = svc
      .getMetric('tools.invocation.estimated_tokens', {
        module: 'tools',
        tool: 'bash',
      })
      ?.get();
    expect(tokens.sum).toBe(8);
  });

  it('缺省 inputBytes / estimatedTokens ⇒ 不记录对应指标（不臆造）', () => {
    recordToolInvocation({ toolName: 'glob', durationMs: 3, success: true });
    expect(
      svc.getMetric('tools.invocation.input_bytes', {
        module: 'tools',
        tool: 'glob',
      })
    ).toBeUndefined();
    expect(
      svc.getMetric('tools.invocation.estimated_tokens', {
        module: 'tools',
        tool: 'glob',
      })
    ).toBeUndefined();
  });
});

describe('S2-6 Tool-Use Context Entropy', () => {
  it('记录 schema tokens 直方图 + 占上下文窗口比例（gauge）', () => {
    recordToolSchemaEntropy({
      toolCount: 40,
      schemaTokens: 10000,
      contextWindowTokens: 200000,
    });

    const hist = svc
      .getMetric('tools.schema.tokens', { module: 'tools' })
      ?.get();
    expect(hist.count).toBe(1);
    expect(hist.sum).toBe(10000);

    const gauge = svc
      .getMetric('tools.schema.context_entropy_percent', { module: 'tools' })
      ?.get();
    expect(gauge).toBeCloseTo(5, 6); // 10000 / 200000 * 100
  });

  it('无上下文窗口 ⇒ 只记 tokens，不设比例（不臆造）', () => {
    recordToolSchemaEntropy({ toolCount: 1, schemaTokens: 123 });
    expect(
      svc.getMetric('tools.schema.tokens', { module: 'tools' })?.get().sum
    ).toBe(123);
    expect(
      svc.getMetric('tools.schema.context_entropy_percent', { module: 'tools' })
    ).toBeUndefined();
  });
});

describe('TG-5 工具 Schema 熵阈值门禁（只告警不阻断 · Fail-Open for Observation）', () => {
  it('阈值常量：第 20 轮 / 30%', () => {
    expect(SCHEMA_ENTROPY_TURN_THRESHOLD).toBe(20);
    expect(SCHEMA_ENTROPY_PERCENT_THRESHOLD).toBe(30);
  });

  it('已达轮次阈值且占比 >30% ⇒ warn（reason=warn）', () => {
    const v = evaluateSchemaEntropyGate({
      toolCount: 40,
      schemaTokens: 70000,
      contextWindowTokens: 200000,
      turn: 20,
    });
    expect(v).not.toBeNull();
    expect(v?.warn).toBe(true);
    expect(v?.reason).toBe('warn');
    expect(v?.percent).toBeCloseTo(35, 6);
  });

  it('轮次未达阈值（turn=19）⇒ 不告警（reason=turn_below_threshold）', () => {
    const v = evaluateSchemaEntropyGate({
      toolCount: 40,
      schemaTokens: 70000,
      contextWindowTokens: 200000,
      turn: 19,
    });
    expect(v?.warn).toBe(false);
    expect(v?.reason).toBe('turn_below_threshold');
  });

  it('占比恰好 30%（边界）⇒ 不告警（判据为严格大于）', () => {
    const v = evaluateSchemaEntropyGate({
      toolCount: 40,
      schemaTokens: 60000,
      contextWindowTokens: 200000,
      turn: 25,
    });
    expect(v?.percent).toBeCloseTo(30, 6);
    expect(v?.warn).toBe(false);
    expect(v?.reason).toBe('percent_below_threshold');
  });

  it('缺 turn 或上下文窗口 ⇒ 返回 null（不臆造，CS06）', () => {
    expect(
      evaluateSchemaEntropyGate({
        toolCount: 1,
        schemaTokens: 100,
        contextWindowTokens: 200000,
      })
    ).toBeNull();
    expect(
      evaluateSchemaEntropyGate({ toolCount: 1, schemaTokens: 100, turn: 30 })
    ).toBeNull();
  });

  it('触发阈值时记录仍不抛（零阻断），且观测 gauge 照常写入', () => {
    expect(() =>
      recordToolSchemaEntropy({
        toolCount: 40,
        schemaTokens: 90000,
        contextWindowTokens: 200000,
        turn: 30,
      })
    ).not.toThrow();
    expect(
      svc
        .getMetric('tools.schema.context_entropy_percent', { module: 'tools' })
        ?.get()
    ).toBeCloseTo(45, 6);
  });
});
