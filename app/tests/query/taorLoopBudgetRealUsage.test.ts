/**
 * batch 侧（TAORLoop）预算**记账量纲**回归 —— 2026-09-26 与流式路径**同批**修复的守卫。
 *
 * 缺陷（与流式同源）：`_observeRound` 原用 `_estimateTokens(messages)`（= `estimateMessagesTokens`）
 * 记账，实测与 provider 真实 `prompt_tokens` 可差 **6× 以上**（同一轮：真实 29,143 vs 估算 185,195）
 * ⇒ 据此判 92% 阈值**必然误杀长任务**。
 * 更隐蔽的一环：`_collectCallModel` 只把**末块** `...lastChunk` 展开，而适配器
 * （`ChatManagerTAORAdapter`）把 `usage` 挂在 `{type:'text'}` 块上、末块是 `{type:'done'}`（不带 usage）
 * ⇒ **usage 被丢掉**，这才使预算"只能退回用估算"。
 *
 * 本用例锁住两条契约：
 *  ① 块里带真实 usage ⇒ `_lastRealPromptTokens` 捕获它，且 `_observeRound` 入账 == `prompt_tokens`；
 *  ② 本轮无 usage ⇒ **不记账**（fail-open，不误杀）。
 */
import { describe, expect, it } from 'bun:test';
import { TAORLoop } from '../../src/query/TAORLoop';
import type { QueryEngine } from '../../src/query/QueryEngine';

/** 测试可访问的私有成员（避免使用 any；沿用 L1 用例的 Testable 写法） */
interface TestableLoop {
  deps: {
    callModel: (...args: unknown[]) => AsyncGenerator<Record<string, unknown>>;
  };
  messages: unknown[];
  tokenBudget: { getCurrentBudgetState(): { currentTokens: number } };
  _lastRealPromptTokens: number;
  _collectCallModel(): AsyncGenerator<unknown, Record<string, unknown>>;
  _observeRound(): Promise<void>;
}

function makeLoop(): TestableLoop {
  return new TAORLoop({} as unknown as QueryEngine) as unknown as TestableLoop;
}

/** 消费异步生成器，确保 `_collectCallModel` 的捕获逻辑执行完 */
async function consume(
  gen: AsyncGenerator<unknown, Record<string, unknown>>
): Promise<void> {
  for await (const _chunk of gen) {
    /* consume */
  }
}

describe('TAORLoop 预算记账量纲：provider 真实 prompt_tokens', () => {
  it('块内带 usage ⇒ 捕获真实量并按真实量入账（不用估算器）', async () => {
    const loop = makeLoop();
    loop.messages = [{ role: 'user', content: 'hi' }];
    // 复刻适配器真实形态：usage 在 {type:'text'} 块；末块 {type:'done'} 不带 usage
    loop.deps.callModel = async function* () {
      yield {
        type: 'text',
        content: 'ok',
        usage: { prompt_tokens: 29143, completion_tokens: 878 },
      };
      yield { type: 'done' };
    };

    await consume(loop._collectCallModel());
    expect(loop._lastRealPromptTokens).toBe(29143);

    await loop._observeRound();
    expect(loop.tokenBudget.getCurrentBudgetState().currentTokens).toBe(29143);
  });

  it('本轮无 usage ⇒ 不记账（fail-open，不误杀）', async () => {
    const loop = makeLoop();
    loop.messages = [{ role: 'user', content: 'hi' }];
    loop.deps.callModel = async function* () {
      yield { type: 'text', content: 'ok' };
      yield { type: 'done' };
    };

    await consume(loop._collectCallModel());
    expect(loop._lastRealPromptTokens).toBe(0);

    await loop._observeRound();
    expect(loop.tokenBudget.getCurrentBudgetState().currentTokens).toBe(0);
  });
});
