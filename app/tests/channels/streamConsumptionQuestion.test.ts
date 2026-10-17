// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * U-05 Stage 1（2026-10-17）：渠道收到交互提问时如实转发并 fail-closed。
 *
 * 锁定：不再“只记日志然后等后端超时”；用户能看到问题，执行以明确原因中止。
 */
import { describe, it, expect } from 'bun:test';
import { consumeStreamChunks } from '../../src/channels/routing/streamConsumption.js';
import type { ChatStreamChunk } from '../../src/runtime/api/CoreAPI.js';

function makeDeps(
  chunks: ChatStreamChunk[],
  opts: {
    supportsQuestionAnswer?: boolean;
    onOutbound?: (content: string, target: string) => Promise<void>;
    requestCancel?: (id: string, reason: string) => void;
  } = {}
) {
  return {
    generator: (async function* () {
      for (const chunk of chunks) yield chunk;
      return { content: '', finishReason: 'stop' };
    })() as AsyncGenerator<
      ChatStreamChunk,
      { content: string; finishReason?: string },
      unknown
    >,
    cancelController: new AbortController(),
    executionManager: {
      requestCancel: opts.requestCancel ?? (() => undefined),
    } as never,
    lease: { executionId: 'exec-1', release: () => undefined } as never,
    message: {
      messageId: 'msg-1',
      senderId: 'user-1',
      conversationId: 'conv-1',
      content: 'hi',
    } as never,
    channelName: 'test',
    traceId: 'trace-1',
    enableLongTaskPlaceholder: false,
    onOutbound: opts.onOutbound,
    llmStartMs: Date.now(),
    supportsQuestionAnswer: opts.supportsQuestionAnswer,
    finishExecution: () => undefined,
  };
}

const questionChunk: ChatStreamChunk = {
  type: 'question',
  content: '',
  sessionId: 's1',
  questionData: {
    questionId: 'q1',
    header: '选择方案',
    question: '要继续吗？',
    options: [
      { label: '继续', description: '' },
      { label: '取消', description: '' },
    ],
    questionType: 'choice',
  },
};

describe('consumeStreamChunks question chunk', () => {
  it('无回答能力 ⇒ 转发问题与提示，并以 CHANNEL_INTERACTION_UNSUPPORTED 中止', async () => {
    const outbound: string[] = [];
    let cancelReason: string | undefined;
    const deps = makeDeps([questionChunk], {
      onOutbound: async (content) => {
        outbound.push(content);
      },
      requestCancel: (_id, reason) => {
        cancelReason = reason;
      },
    });

    let error: unknown;
    try {
      await consumeStreamChunks(deps);
    } catch (e) {
      error = e;
    }

    expect(error).toBeDefined();
    expect((error as { reason?: string }).reason).toBe(
      'CHANNEL_INTERACTION_UNSUPPORTED'
    );
    expect(cancelReason).toBe('CHANNEL_INTERACTION_UNSUPPORTED');
    expect(outbound.length).toBe(2);
    expect(outbound[0]).toContain('要继续吗？');
    expect(outbound[0]).toContain('1. 继续');
    expect(outbound[1]).toContain('不支持交互回答');
  });

  it('有回答能力 ⇒ 只转发问题，不中止', async () => {
    const outbound: string[] = [];
    const result = await consumeStreamChunks(
      makeDeps([questionChunk], {
        supportsQuestionAnswer: true,
        onOutbound: async (content) => {
          outbound.push(content);
        },
      })
    );
    expect(outbound.length).toBe(1);
    expect(result.finishReason).toBe('stop');
  });
});
