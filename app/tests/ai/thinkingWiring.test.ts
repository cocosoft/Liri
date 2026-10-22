/**
 * `/effort` 第二步：思考预算 → 各协议请求体（2026-10-23）
 *
 * 覆盖两段：
 *  ① 会话元数据 → `thinking` 配置（`resolveThinkingForSession`，含能力门控）；
 *  ② `thinking` → 请求体字段：
 *     - Messages API：`thinking.budget_tokens`（并保证 `max_tokens > budget`）
 *     - Chat Completions：`reasoning_effort`（low/medium/high）
 *     - Gemini：`generationConfig.thinkingConfig.thinkingBudget`
 *
 * 缺省（auto / 无能力 / 无预算）⇒ **不下发任何思考字段**（行为零变更）。
 */
import { describe, expect, it } from 'bun:test';

import {
  resolveThinkingForSession,
  resolveEffortThinkingBudget,
} from '../../src/chat/replyEffort';
import { toReasoningEffort } from '../../src/ai/clients/thinking';
import { MessagesApiTransport } from '../../src/ai/transports/AnthropicMessagesTransport';
import { ChatCompletionsTransport } from '../../src/ai/transports/ChatCompletionsTransport';
import { GeminiTransport } from '../../src/ai/transports/GeminiTransport';

const MESSAGES = [{ role: 'user', content: 'hi' }];

describe('resolveThinkingForSession（会话元数据 → thinking）', () => {
  it('模型不具备 thinking 能力 ⇒ 不注入', () => {
    expect(
      resolveThinkingForSession({ effortLevel: 'high' }, false)
    ).toBeUndefined();
  });

  it('显式 thinkingBudget 优先于 effortLevel', () => {
    expect(
      resolveThinkingForSession(
        { effortLevel: 'low', thinkingBudget: 8000 },
        true
      )
    ).toEqual({ type: 'enabled', budgetTokens: 8000 });
  });

  it('仅有 effortLevel ⇒ 按档位换算', () => {
    expect(resolveThinkingForSession({ effortLevel: 'high' }, true)).toEqual({
      type: 'enabled',
      budgetTokens: 32000,
    });
  });

  it('auto / 缺失 / 非法 ⇒ 不注入', () => {
    expect(
      resolveThinkingForSession({ effortLevel: 'auto' }, true)
    ).toBeUndefined();
    expect(resolveThinkingForSession(undefined, true)).toBeUndefined();
    expect(
      resolveThinkingForSession({ effortLevel: 'wat' }, true)
    ).toBeUndefined();
    expect(
      resolveThinkingForSession({ thinkingBudget: 0 }, true)
    ).toBeUndefined();
  });

  it('resolveEffortThinkingBudget 与 EFFORT_TO_BUDGET 对齐', () => {
    expect(resolveEffortThinkingBudget('low')).toBe(4000);
    expect(resolveEffortThinkingBudget('medium')).toBe(16000);
    expect(resolveEffortThinkingBudget('high')).toBe(32000);
    expect(resolveEffortThinkingBudget('auto')).toBeUndefined();
  });
});

describe('toReasoningEffort（预算 → Chat Completions 档位）', () => {
  it('档位映射', () => {
    expect(toReasoningEffort({ type: 'enabled', budgetTokens: 4000 })).toBe(
      'low'
    );
    expect(toReasoningEffort({ type: 'enabled', budgetTokens: 8000 })).toBe(
      'medium'
    );
    expect(toReasoningEffort({ type: 'enabled', budgetTokens: 16000 })).toBe(
      'medium'
    );
    expect(toReasoningEffort({ type: 'enabled', budgetTokens: 32000 })).toBe(
      'high'
    );
  });

  it('非 enabled ⇒ 不下发', () => {
    expect(toReasoningEffort(undefined)).toBeUndefined();
    expect(toReasoningEffort({ type: 'disabled' })).toBeUndefined();
    expect(toReasoningEffort({ type: 'adaptive' })).toBeUndefined();
  });
});

describe('Messages API：thinking.budget_tokens', () => {
  const transport = new MessagesApiTransport();

  it('enabled ⇒ 下发 budget_tokens，且 max_tokens 自动抬高到 budget + 1024', () => {
    const body = transport.buildRequest({
      model: 'demo',
      messages: MESSAGES,
      maxTokens: 4096,
      thinking: { type: 'enabled', budgetTokens: 8000 },
    });

    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 8000 });
    expect(body.max_tokens).toBe(9024);
  });

  it('缺省 ⇒ 不带 thinking，max_tokens 原样', () => {
    const body = transport.buildRequest({
      model: 'demo',
      messages: MESSAGES,
      maxTokens: 4096,
    });

    expect('thinking' in body).toBe(false);
    expect(body.max_tokens).toBe(4096);
  });
});

describe('Chat Completions：reasoning_effort', () => {
  const transport = new ChatCompletionsTransport();

  it('enabled ⇒ 按预算映射档位', () => {
    const medium = transport.buildRequest({
      model: 'demo',
      messages: MESSAGES,
      thinking: { type: 'enabled', budgetTokens: 8000 },
    });
    expect(medium.reasoning_effort).toBe('medium');

    const high = transport.buildRequest({
      model: 'demo',
      messages: MESSAGES,
      thinking: { type: 'enabled', budgetTokens: 32000 },
    });
    expect(high.reasoning_effort).toBe('high');
  });

  it('缺省 / disabled ⇒ 不下发 reasoning_effort', () => {
    expect(
      'reasoning_effort' in
        transport.buildRequest({ model: 'demo', messages: MESSAGES })
    ).toBe(false);
    expect(
      'reasoning_effort' in
        transport.buildRequest({
          model: 'demo',
          messages: MESSAGES,
          thinking: { type: 'disabled' },
        })
    ).toBe(false);
  });
});

describe('Gemini：generationConfig.thinkingConfig', () => {
  const transport = new GeminiTransport();

  it('enabled ⇒ 下发 thinkingBudget', () => {
    const body = transport.buildRequest({
      model: 'demo',
      messages: MESSAGES,
      thinking: { type: 'enabled', budgetTokens: 8000 },
    });

    const config = body.generationConfig as Record<string, unknown>;
    expect(config.thinkingConfig).toEqual({ thinkingBudget: 8000 });
  });

  it('缺省 ⇒ 不带 thinkingConfig', () => {
    const body = transport.buildRequest({ model: 'demo', messages: MESSAGES });
    const config = body.generationConfig as Record<string, unknown>;

    expect('thinkingConfig' in config).toBe(false);
  });
});
