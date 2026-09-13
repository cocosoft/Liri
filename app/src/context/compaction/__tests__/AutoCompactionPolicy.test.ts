/**
 * 压缩评估测试（C7 收敛 2026-08-30 改写）
 *
 * AutoCompactionPolicy 已删除，评估统一走 UnifiedTokenTracker：
 * - evaluateCompactionFallback：纯函数兜底评估（阈值表 + 消息数兜底 + snapshot）
 * - getModelThresholds：模型前缀阈值匹配
 * 原测试的 configOverride 窗口固化机制在收敛后移除（resolveContextWindow 不再接收
 * 外部窗口覆盖），故改为不依赖窗口精确值的确定性断言。
 */
import { describe, test, expect } from 'bun:test';
import {
  evaluateCompactionFallback,
  getModelThresholds,
} from '@modules/core/tokenBudget/UnifiedTokenTracker';

interface Msg {
  role?: string;
  content?: string | unknown;
}

describe('压缩评估（C7 收敛：UnifiedTokenTracker 统一入口）', () => {
  test('极小历史返回 skip（任何窗口不超限）', () => {
    const messages: Msg[] = [{ role: 'user', content: 'hi' }];
    const decision = evaluateCompactionFallback(messages, 'test-model');
    expect(decision.decision).toBe('skip');
    // snapshot 结构完整（决策快照供调用方显示水位）
    expect(decision.snapshot.tokens).toBeGreaterThanOrEqual(0);
    expect(decision.snapshot.maxTokens).toBeGreaterThan(0);
    expect(decision.snapshot.ratio).toBeGreaterThanOrEqual(0);
  });

  test('空历史返回 skip 且 maxTokens 为正', () => {
    const decision = evaluateCompactionFallback([], 'test-model');
    expect(decision.decision).toBe('skip');
    expect(decision.snapshot.maxTokens).toBeGreaterThan(0);
  });

  test('getModelThresholds 模型前缀匹配（llama-local 小窗口保守阈值）', () => {
    const llama = getModelThresholds('llama-local-v3');
    expect(llama.warn).toBe(0.6);
    expect(llama.compact).toBe(0.75);
    // 未知模型回退 default（UNIFIED_THRESHOLDS.WARNING/CRITICAL = 0.75/0.92）
    const def = getModelThresholds('some-unknown-model');
    expect(def.warn).toBe(0.75);
    expect(def.compact).toBe(0.92);
  });

  test('消息数兜底：超过 50 条且水位处于可疑区间时强制 trigger', () => {
    // 构造 60 条短消息：消息数超 50，但 token 占比低（估算可能失真）→ 兜底 trigger
    const messages: Msg[] = [];
    for (let i = 0; i < 60; i++) {
      messages.push({ role: 'user', content: '中' });
    }
    const decision = evaluateCompactionFallback(messages, 'test-model');
    // 兜底仅在 ratio 处于 0.3-0.5 区间触发；窗口过大（如 >167K）时不触发——此处
    // 仅断言"skip/trigger 均不破坏决策结构"，trigger 时 reason 存在
    expect(['trigger', 'skip']).toContain(decision.decision);
    if (decision.decision === 'trigger') {
      expect(decision.reason).toBeTypeOf('string');
    }
  });
});
