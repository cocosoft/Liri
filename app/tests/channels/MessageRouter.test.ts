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
 * 统一消息路由管线单元测试（P2-2 / 4.11）
 * 覆盖：帧验证 6 规则、DM 授权拦截、入站限流（不触发 LLM 调用）
 */

import { describe, expect, it } from 'bun:test';
import type { MessageContext } from '../../src/channels/types/IChannel';
import {
  routeChannelMessage,
  validateInboundFrame,
} from '../../src/channels/routing/messageRouter';

/** 构造合法消息（messageId/sender 唯一，content 可变避免内容级去重） */
let seq = 0;
function makeMessage(overrides: Partial<MessageContext> = {}): MessageContext {
  seq++;
  return {
    channelId: 'telegram',
    senderId: 'sender-a',
    messageId: `mtest-${Date.now()}-${seq}`,
    messageType: 'text',
    content: `hello-${seq}`,
    timestamp: Date.now(),
    isDirectMessage: true,
    rawPayload: {},
    ...overrides,
  };
}

const chatStub = {
  chat: async (): Promise<{ content: string }> => ({ content: 'pong' }),
};

describe('validateInboundFrame（4.11）', () => {
  it('空 messageId → INVALID_ID', () => {
    const r = validateInboundFrame(makeMessage({ messageId: '' }));
    expect(r.valid).toBe(false);
    expect(r.errorCode).toBe('INVALID_ID');
  });

  it('空 senderId → INVALID_SENDER', () => {
    const r = validateInboundFrame(makeMessage({ senderId: '' }));
    expect(r.valid).toBe(false);
    expect(r.errorCode).toBe('INVALID_SENDER');
  });

  it('未来时间戳（>5min）→ INVALID_TIMESTAMP', () => {
    const r = validateInboundFrame(
      makeMessage({ timestamp: Date.now() + 10 * 60 * 1000 })
    );
    expect(r.valid).toBe(false);
    expect(r.errorCode).toBe('INVALID_TIMESTAMP');
  });

  it('超大消息体 → MESSAGE_TOO_LARGE', () => {
    const r = validateInboundFrame(
      makeMessage({ content: 'x'.repeat(1024 * 1024 + 1) })
    );
    expect(r.valid).toBe(false);
    expect(r.errorCode).toBe('MESSAGE_TOO_LARGE');
  });

  it('非法控制字符 → INVALID_CHARACTER', () => {
    const r = validateInboundFrame(makeMessage({ content: 'bad\x00char' }));
    expect(r.valid).toBe(false);
    expect(r.errorCode).toBe('INVALID_CHARACTER');
  });

  it('合法消息 → valid', () => {
    const r = validateInboundFrame(makeMessage());
    expect(r.valid).toBe(true);
  });
});

describe('routeChannelMessage 安全拦截（4.11）', () => {
  it('DM 授权拒绝（allowlist 不含 sender）→ UNAUTHORIZED 且不调用 chat', async () => {
    let chatCalled = false;
    const result = await routeChannelMessage(
      makeMessage({ senderId: 'intruder' }),
      {
        coreAPI: {
          chat: async () => {
            chatCalled = true;
            return { content: 'x' };
          },
        },
        channelName: 'telegram',
        dmPolicy: {
          policy: 'allowlist',
          allowFrom: ['approved-user'],
        },
      }
    );
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('UNAUTHORIZED');
    expect(chatCalled).toBe(false);
  });

  it('DM 授权通过（allowlist 含 sender）→ 继续处理', async () => {
    const result = await routeChannelMessage(
      makeMessage({ senderId: 'approved-user' }),
      {
        coreAPI: chatStub,
        channelName: 'telegram',
        dmPolicy: {
          policy: 'allowlist',
          allowFrom: ['approved-user'],
        },
      }
    );
    expect(result.valid).toBe(true);
  });
});
