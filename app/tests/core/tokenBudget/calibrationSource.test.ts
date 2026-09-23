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
 * D1（2026-09-23）：token 校准数据源切换的**行为等价**与**缺样本计数**单测。
 *
 * 背景：Spec `.trae/specs/trajectory-single-source-convergence.md` v0.2 裁决 D1 ——
 * 校准数据源从 `traces/` 落盘数据（`traceUsageListeners`）收敛为 `metric/timing`
 * 事件载荷；`traces/` 降级为观测层。
 *
 * 本文件锁三件事：
 *  ① **等价**：同为真实 usage，`buildRequestTimingData`（事件侧，新）与
 *     `extractUsage({usage})`（旧 `recordPostRequest` 路径）抽出的 token 完全一致
 *     ⇒ 同一序列喂入两个入口，`calibrationFactor` 收敛值相同（并给出数值）。
 *  ② **不冒充**：缺 usage / 缺基线 ⇒ 因子**保持既有值**，仅**计数**（可观测）。
 *  ③ **闭环**：`metric/timing` 载荷能真正驱动因子（EMA 逐步逼近 raw）。
 *
 * 说明：`persistCalibrationFactor` 是 500ms 防抖真实落盘（生产同一路径），
 * 本用例模型名固定为 `d1-calibration-test`（生产不存在该模型）⇒ 不污染真实因子。
 */

import { describe, expect, it } from 'bun:test';
import type { ContextTracker } from '@modules/query';
import { buildRequestTimingData } from '../../../src/chat/services/timingEvent';
import { extractUsage } from '../../../src/ai/tokenizer/UsageExtractor';
import { TokenBudgetController } from '../../../src/core/tokenBudget/TokenBudgetController';
import { UnifiedTokenTracker } from '../../../src/core/tokenBudget/UnifiedTokenTracker';

const MODEL = 'd1-calibration-test';
/** 固定 overhead（构造注入；测试内可精确复现 EMA 期望值） */
const OVERHEAD = { systemPrompt: 100, toolDefs: 50 };
const ALPHA = 0.3;

function makeTracker(): UnifiedTokenTracker {
  const controller = new TokenBudgetController(MODEL, {
    total: 1_000_000,
    remaining: 1_000_000,
    used: 0,
  });
  // 上下文追踪器仅用于压缩记录，本用例不触发；空实现避免引入无关依赖
  const contextTracker = {} as unknown as ContextTracker;
  return new UnifiedTokenTracker(controller, contextTracker, OVERHEAD);
}

/** 建立估算基线（默认会话）：返回 baseline（估算输入 token） */
async function setupBaseline(tracker: UnifiedTokenTracker): Promise<number> {
  await tracker.checkBeforeRequest(
    [
      { role: 'system', content: '你是助手，请用中文回答。'.repeat(20) },
      {
        role: 'user',
        content: '请解释一下上下文压缩的工作原理。'.repeat(200),
      },
    ],
    MODEL,
    4096
  );
  const baseline = tracker.getCurrentInputTokens();
  if (!baseline || baseline <= 0) {
    throw new Error(
      'baseline 未建立：checkBeforeRequest 应设置 baselineInputTokens'
    );
  }
  return baseline;
}

/**
 * provider 返回并被**两条路径都能解析**的 usage 形态（字段名各异）。
 *
 * 说明：`buildRequestTimingData` 与 `extractUsage` 都识别 `prompt_tokens/completion_tokens`
 * 与内部归一化的 `inputTokens/outputTokens`（Anthropic 的 `input_tokens` 由
 * `AnthropicProvider` 在 provider 层已归一化为 `prompt_tokens`，见
 * `AnthropicProvider.ts:321-331`）——本用例只覆盖两者共同识别的形态。
 */
const REAL_USAGE_SAMPLES: Array<Record<string, unknown>> = [
  { prompt_tokens: 1200, completion_tokens: 240, total_tokens: 1440 },
  { inputTokens: 1500, outputTokens: 180, totalTokens: 1680 },
  {
    prompt_tokens: 900,
    completion_tokens: 120,
    prompt_tokens_details: { cached_tokens: 300 },
  },
  {
    prompt_tokens: 1800,
    completion_tokens: 300,
    prompt_cache_hit_tokens: 512,
    prompt_cache_miss_tokens: 1288,
  },
];

describe('D1 校准数据源（metric/timing 事件载荷）', () => {
  it('① 等价：事件载荷与旧 api-body 路径抽出的 token 逐样本一致', () => {
    for (const sample of REAL_USAGE_SAMPLES) {
      const payload = buildRequestTimingData(sample);
      const legacy = extractUsage({ usage: sample });
      if (!payload || !legacy) {
        throw new Error(`样本应可抽取：${JSON.stringify(sample)}`);
      }
      expect(payload.inputTokens).toBe(legacy.inputTokens);
      expect(payload.outputTokens).toBe(legacy.outputTokens);
    }
  });

  it('① 等价：同序列喂入两入口 ⇒ calibrationFactor 收敛值相同（含数值）', async () => {
    const viaEvent = makeTracker();
    const viaApiBody = makeTracker();
    const baseline = await setupBaseline(viaEvent);
    await setupBaseline(viaApiBody);

    // 样本按**实测 baseline** 等比缩放（raw ∈ [0.85, 1.15]），使 EMA 序列可核对；
    // 形态仍是 provider 原始 usage（prompt_tokens/completion_tokens）
    const overheadTotal = OVERHEAD.systemPrompt + OVERHEAD.toolDefs;
    const ratios = [0.85, 1.0, 1.15, 0.95];
    const samples: Array<Record<string, unknown>> = ratios.map((r) => ({
      prompt_tokens: Math.round(r * baseline) + overheadTotal,
      completion_tokens: 120,
      total_tokens: Math.round(r * baseline) + overheadTotal + 120,
    }));

    let expected = 1.0;
    const expectedSeries: number[] = [];
    for (const sample of samples) {
      const payload = buildRequestTimingData(sample);
      if (!payload) throw new Error('样本应可抽取');
      viaEvent.recordTimingUsage(payload);
      viaApiBody.recordPostRequest({ usage: sample });

      const corrected = (payload.inputTokens ?? 0) - overheadTotal;
      const raw = corrected / baseline;
      expected = ALPHA * raw + (1 - ALPHA) * expected;
      expectedSeries.push(expected);

      expect(viaEvent.getCalibrationFactor()).toBeCloseTo(expected, 10);
      expect(viaApiBody.getCalibrationFactor()).toBeCloseTo(expected, 10);
    }

    // 两入口逐次一致（等价）
    expect(viaEvent.getCalibrationFactor()).toBe(
      viaApiBody.getCalibrationFactor()
    );
    // 数值证据（便于报告核对）
    console.info(
      '[D1 等价] baseline=%d raw序列=%s 收敛序列=%s 终点=%s',
      baseline,
      ratios.map((r) => r.toFixed(2)).join(','),
      expectedSeries.map((v) => v.toFixed(6)).join(' -> '),
      viaEvent.getCalibrationFactor().toFixed(6)
    );
    expect(viaEvent.getCalibrationStats().applied).toBe(samples.length);
    expect(viaEvent.getCalibrationStats().missingUsage).toBe(0);
    expect(viaEvent.getCalibrationStats().missingBaseline).toBe(0);
  });

  it('② 缺 usage ⇒ 只计数、因子不变（不估算冒充）', async () => {
    const tracker = makeTracker();
    await setupBaseline(tracker);
    const before = tracker.getCalibrationFactor();

    tracker.recordTimingUsage({});
    tracker.recordTimingUsage({ inputTokens: 0, outputTokens: 0 });

    expect(tracker.getCalibrationFactor()).toBe(before);
    const stats = tracker.getCalibrationStats();
    expect(stats.missingUsage).toBe(2);
    expect(stats.applied).toBe(0);
  });

  it('② 缺基线 ⇒ 只计数、因子不变（有真实 usage 也不臆测 ratio）', () => {
    const tracker = makeTracker();
    const before = tracker.getCalibrationFactor();

    tracker.recordTimingUsage({ inputTokens: 1200, outputTokens: 200 });

    expect(tracker.getCalibrationFactor()).toBe(before);
    const stats = tracker.getCalibrationStats();
    expect(stats.missingBaseline).toBe(1);
    expect(stats.missingUsage).toBe(0);
    expect(stats.applied).toBe(0);
  });

  it('③ 闭环：单样本 EMA 精确等于 alpha*raw + (1-alpha)*old', async () => {
    const tracker = makeTracker();
    const baseline = await setupBaseline(tracker);
    const payload = buildRequestTimingData({ prompt_tokens: 2000, completion_tokens: 100 });
    if (!payload) throw new Error('样本应可抽取');

    tracker.recordTimingUsage(payload);

    const raw =
      ((payload.inputTokens ?? 0) - (OVERHEAD.systemPrompt + OVERHEAD.toolDefs)) /
      baseline;
    expect(tracker.getCalibrationFactor()).toBeCloseTo(
      ALPHA * raw + (1 - ALPHA) * 1.0,
      10
    );
  });
});
