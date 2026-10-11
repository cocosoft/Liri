// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T9（Spec `daily-budget-over-limit-ux.md` §5-D-1 C / Review Focus #4）：
// **通道侧撞限必须透出原因与出路** —— 渠道用户看不到桌面端限额卡片、也没有可点按钮，
// 若沿用"消息处理失败"的通用兜底，用户既不知原因也不知如何放行（当前痛点）。
//
// 断言口径（决策规则层；接线由既有 `routeChannelMessage` + `test:guarded` 回归兜底）：
//  ① 文案表：`resolveLlmFailure` 仅对 `DAILY_BUDGET_EXCEEDED` 给限额文案（含"预算"与放行指引），
//     其余（含无码）保持既有通用兜底（**不回归**）；
//  ② 码保真：`consumeStreamChunks` 原先丢弃 `chunk.errorCode` ⇒ 上层无从分流；现须透出。

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveLlmFailure } from '../../src/channels/routing/messageRouterContract';
import { consumeStreamChunks } from '../../src/channels/routing/streamConsumption';
import type { ChatStreamChunk } from '../../src/runtime/api/CoreAPI';
import type { MessageContext } from '../../src/channels/types/IChannel';

const APP_SRC = join(import.meta.dir, '..', '..', 'src');

describe('T9：通道侧撞限文案（resolveLlmFailure）', () => {
  it('DAILY_BUDGET_EXCEEDED ⇒ 文案含**原因**（预算）与**出路**（放行指引），而非"消息处理失败"', () => {
    const failure = resolveLlmFailure('DAILY_BUDGET_EXCEEDED');

    expect(failure.outbound).toContain('预算');
    expect(failure.outbound).toContain('日限额');
    expect(failure.outbound).not.toContain('消息处理失败');
    expect(failure.errorCode).toBe('DAILY_BUDGET_EXCEEDED');
    expect(failure.errorMessage).toContain('预算');
  });

  it('无码 / LLM_ERROR ⇒ 保持既有通用兜底（**不回归**）', () => {
    for (const code of [undefined, 'LLM_ERROR'] as const) {
      const failure = resolveLlmFailure(code);
      expect(failure.outbound).toBe('⚠️ 消息处理失败，请稍后重发重试。');
      expect(failure.errorCode).toBe('LLM_ERROR');
      expect(failure.errorMessage).toBe('消息处理失败，请稍后重试');
    }
  });

  it('其它业务码（非限额）⇒ 不误分流为限额文案', () => {
    const failure = resolveLlmFailure('CONTEXT_OVERFLOW');
    expect(failure.errorCode).toBe('LLM_ERROR');
    expect(failure.outbound).not.toContain('预算');
  });
});

describe('T9：流式消费保留真实业务码（consumeStreamChunks）', () => {
  /** 最小 message / 消费依赖（只覆盖本用例实际触达的字段） */
  function makeDeps(
    chunks: ChatStreamChunk[],
    final: { content: string; finishReason?: string } = {
      content: '',
      finishReason: 'error',
    }
  ): {
    deps: Parameters<typeof consumeStreamChunks>[0];
    events: Array<{ ok: boolean; reason?: string }>;
  } {
    const events: Array<{ ok: boolean; reason?: string }> = [];
    const message = {
      messageId: 'msg-t9',
      conversationId: 'conv-t9',
      senderId: 'user-t9',
    } as unknown as MessageContext;
    // 生成器：逐个产出 chunk，最后返回终态（= Write-Ahead 已持久化后的 ChatResponse）
    async function* generator(): AsyncGenerator<
      ChatStreamChunk,
      { content: string; finishReason?: string },
      unknown
    > {
      for (const c of chunks) yield c;
      return final;
    }
    return {
      events,
      deps: {
        generator: generator(),
        cancelController: new AbortController(),
        executionManager: {
          requestCancel: () => {},
        } as unknown as Parameters<
          typeof consumeStreamChunks
        >[0]['executionManager'],
        lease: { executionId: 'exec-t9' } as unknown as Parameters<
          typeof consumeStreamChunks
        >[0]['lease'],
        message,
        channelName: 'test-channel',
        traceId: 'trace-t9',
        enableLongTaskPlaceholder: false,
        llmStartMs: Date.now(),
        finishExecution: (ok, reason) => {
          events.push({ ok, reason });
        },
      },
    };
  }

  function errorChunk(errorCode?: string): ChatStreamChunk {
    return {
      type: 'error',
      content: '今日 Token 预算已用完',
      sessionId: 'sess-t9',
      ...(errorCode ? { errorCode } : {}),
    } as ChatStreamChunk;
  }

  it('错误 chunk 带码 ⇒ 结果透出该码（上层可据此分流）且判失败', async () => {
    const { deps, events } = makeDeps([errorChunk('DAILY_BUDGET_EXCEEDED')]);
    const result = await consumeStreamChunks(deps);

    expect(result.finishReason).toBe('error');
    expect(result.errorCode).toBe('DAILY_BUDGET_EXCEEDED');
    expect(result.content).toBe('');
    expect(events).toEqual([{ ok: false, reason: '今日 Token 预算已用完' }]);
  });

  it('错误 chunk 无码 ⇒ 不带 errorCode（由上层按通用失败兜底，不伪造码）', async () => {
    const { deps } = makeDeps([errorChunk()]);
    const result = await consumeStreamChunks(deps);

    expect(result.finishReason).toBe('error');
    expect(result.errorCode).toBeUndefined();
  });

  it('正常收流 ⇒ 不透出 errorCode（不误标失败）', async () => {
    const { deps } = makeDeps(
      [
        {
          type: 'text',
          content: '你好',
          sessionId: 'sess-t9',
        } as ChatStreamChunk,
      ],
      { content: '你好', finishReason: 'stop' }
    );
    const result = await consumeStreamChunks(deps);

    expect(result.finishReason).toBe('stop');
    expect(result.content).toBe('你好');
    expect(result.errorCode).toBeUndefined();
  });
});

describe('T9：接线防漂移（routeChannelMessage 使用统一文案表）', () => {
  it('messageRouter 的 llm 失败分支经 resolveLlmFailure 取文案与码', () => {
    const code = readFileSync(
      join(APP_SRC, 'channels/routing/messageRouter.ts'),
      'utf-8'
    );
    // 必须：经统一文案表解析（否则会退回硬编码通用兜底）
    expect(code).toMatch(/resolveLlmFailure\s*\(/);
    // 禁止：llm 失败分支再出现**硬编码**的通用兜底文案（已收敛到文案表）
    expect(code).not.toContain('⚠️ 消息处理失败，请稍后重发重试。');
  });
});
