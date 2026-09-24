/**
 * MessagesApiTransport 请求体字段契约（N-55，2026-09-24）
 *
 * §11.2 #1 取证时发现两处与 `TransportRequestParams` 契约不符的**静默丢弃**：
 *
 * 1. `stream` —— 契约里确有（`types.ts:120-121`），且**同族 4 处实现都消费它**
 *    （BedrockTransport / ChatCompletionsTransport / OllamaTransport / TransportProviderAdapter），
 *    唯此处不消费 ⇒ 请求体缺 `"stream": true`；而 Messages API 默认 `stream:false` 返回
 *    **非流式 JSON**，调用方 `AnthropicProvider.chatStreamInternal` 却按 **SSE** 解析
 *    ⇒ 该 provider 的流式链路拿不到任何事件。
 * 2. `temperature: 0` —— 原条件 `> 0` 把 0 当成"未设置" ⇒ 要求**确定性输出**的调用静默失效
 *    （实际按 API 默认 1.0 处理）。
 *
 * 「修复前必失败」：上述两例在修复前分别为 `undefined`（断言 `true` / `0` 失败）。
 */

import { describe, it, expect } from 'bun:test';
import { MessagesApiTransport } from '../../../src/ai/transports/AnthropicMessagesTransport.js';
import type { TransportRequestParams } from '../../../src/ai/transports/types.js';

const transport = new MessagesApiTransport();

function build(
  extra: Partial<TransportRequestParams>
): Record<string, unknown> {
  return transport.buildRequest({
    model: 'test-model',
    maxTokens: 1024,
    messages: [{ role: 'user', content: '你好' }],
    ...extra,
  } as TransportRequestParams);
}

describe('N-55：stream 必须按契约下发', () => {
  it('stream=true ⇒ 请求体带 stream:true（修复前为 undefined）', () => {
    expect(build({ stream: true }).stream).toBe(true);
  });

  it('stream 省略 ⇒ 不带该键（不臆造字段）', () => {
    expect('stream' in build({})).toBe(false);
  });

  it('stream=false ⇒ 不带该键（API 默认即非流式，无需显式下发）', () => {
    expect('stream' in build({ stream: false })).toBe(false);
  });
});

describe('N-55：temperature:0 不得被静默丢弃', () => {
  it('temperature=0 ⇒ 原样下发（修复前被丢弃）', () => {
    expect(build({ temperature: 0 }).temperature).toBe(0);
  });

  it('temperature=0.7 ⇒ 原样下发（回归）', () => {
    expect(build({ temperature: 0.7 }).temperature).toBe(0.7);
  });

  it('temperature 省略 ⇒ 不带该键（交给 API 默认）', () => {
    expect('temperature' in build({})).toBe(false);
  });
});
