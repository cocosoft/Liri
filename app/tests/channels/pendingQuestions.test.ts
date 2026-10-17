// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * U-05b（2026-10-17）：渠道交互提问“下一条消息即答案”。
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  buildQuestionKey,
  clearPendingQuestions,
  peekPendingQuestion,
  registerPendingQuestion,
  removePendingQuestion,
} from '../../src/channels/routing/pendingQuestions.js';
import { routeChannelMessage } from '../../src/channels/routing/messageRouter.js';
import type { MessageContext } from '../../src/channels/types/IChannel.js';

let seq = 0;
function makeMessage(overrides: Partial<MessageContext> = {}): MessageContext {
  seq++;
  return {
    channelId: 'telegram',
    senderId: 'qa-user',
    messageId: `qa-${Date.now()}-${seq}`,
    messageType: 'text',
    content: '继续',
    timestamp: Date.now(),
    isDirectMessage: true,
    conversationId: 'conv-qa',
    rawPayload: {},
    ...overrides,
  };
}

describe('pendingQuestions 注册表', () => {
  beforeEach(() => clearPendingQuestions());

  it('TTL 到期即清理', () => {
    const key = 'telegram:u:c';
    registerPendingQuestion(
      key,
      { questionId: 'q1', sessionId: 's1' },
      10,
      1000
    );
    expect(peekPendingQuestion(key, 1009)?.questionId).toBe('q1');
    expect(peekPendingQuestion(key, 1010)).toBeUndefined();
  });

  it('键按渠道+发送者+会话隔离', () => {
    const a = buildQuestionKey('telegram', 'u1', 'c1');
    const b = buildQuestionKey('telegram', 'u1', 'c2');
    registerPendingQuestion(a, { questionId: 'q1', sessionId: 's1' });
    expect(peekPendingQuestion(b)).toBeUndefined();
  });

  it('remove 幂等', () => {
    const key = 'k';
    registerPendingQuestion(key, { questionId: 'q1', sessionId: 's1' });
    removePendingQuestion(key);
    removePendingQuestion(key);
    expect(peekPendingQuestion(key)).toBeUndefined();
  });
});

describe('messageRouter：待答问题消费', () => {
  beforeEach(() => clearPendingQuestions());

  it('命中待答 ⇒ 调 resolveInteraction 且不启动 chatStream', async () => {
    const msg = makeMessage();
    const key = buildQuestionKey('telegram', msg.senderId, msg.conversationId);
    registerPendingQuestion(key, {
      questionId: 'q1',
      sessionId: 'sess-1',
      questionType: 'open',
    });

    let resolvedArgs: unknown[] | undefined;
    let streamCalled = false;
    const result = await routeChannelMessage(msg, {
      coreAPI: {
        chat: async () => ({ content: 'x' }),
        resolveInteraction: async (...args: unknown[]) => {
          resolvedArgs = args;
          return true;
        },
        chatStream: async function* () {
          streamCalled = true;
          yield { type: 'text', content: 'x', sessionId: '' } as const;
          return { content: 'x', finishReason: 'stop' };
        },
      } as never,
      channelName: 'telegram',
      supportsQuestionAnswer: true,
      onOutbound: async () => undefined,
      dmPolicy: { policy: 'allowlist', allowFrom: [msg.senderId] },
    });

    expect(result.valid).toBe(true);
    expect(result.response).toBe('question_answered');
    expect(resolvedArgs).toEqual(['q1', ['继续'], 'sess-1']);
    expect(streamCalled).toBe(false);
    expect(peekPendingQuestion(key)).toBeUndefined();
  });

  it('resolve 失败 ⇒ 返回 QUESTION_RESOLVE_FAILED 且保留待答以便重试', async () => {
    const msg = makeMessage({
      conversationId: 'conv-qa-2',
      content: '继续-2',
    });
    const key = buildQuestionKey('telegram', msg.senderId, msg.conversationId);
    registerPendingQuestion(key, { questionId: 'q1', sessionId: 'sess-1' });

    const result = await routeChannelMessage(msg, {
      coreAPI: {
        chat: async () => ({ content: 'x' }),
        resolveInteraction: async () => false,
        chatStream: async function* () {
          yield { type: 'text', content: 'x', sessionId: '' } as const;
          return { content: 'x', finishReason: 'stop' };
        },
      } as never,
      channelName: 'telegram',
      supportsQuestionAnswer: true,
      dmPolicy: { policy: 'allowlist', allowFrom: [msg.senderId] },
    });

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('QUESTION_RESOLVE_FAILED');
    expect(peekPendingQuestion(key)?.questionId).toBe('q1');
  });
});
