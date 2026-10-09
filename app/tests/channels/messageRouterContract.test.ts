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
 * `messageRouter` **时序契约测试矩阵**（R4，第九轮审查 §3.1）
 *
 * 与既有 `MessageRouter.test.ts`（单测）互补：本文件测的是**跨阶段时序契约**
 * （去重 / 取消与异常 / 重试 / 出站一次 / 帧校验短路 / 跨账号去重作用域）。
 *
 * | # | 契约 | 判据 |
 * |---|---|---|
 * | ① | 同一消息并发到达两次 | 只调用一次 `chatStream`（第二次 `inflight_skipped`） |
 * | ② | 取消/异常 | 不判成功（`fail` 而非 `complete`），半成品**不出站** |
 * | ③ | 消费中断网 | 释放消息锁 ⇒ **允许重试**（同键可再次处理） |
 * | ④ | 出站 | `onOutbound` **恰好一次**；抛错**不自动重发** |
 * | ⑤ | 帧校验失败 | **不进入后续业务阶段**（不调用 `chatStream`） |
 * | ⑥ | 不同账号同 messageId | **不跨账号误去重**（键作用域 = 渠道:发送者:messageId） |
 */
import { describe, expect, it, spyOn } from 'bun:test';
import type { MessageContext } from '../../src/channels/types/IChannel';
import { routeChannelMessage } from '../../src/channels/routing/messageRouter';
import { getExecutionManager } from '../../src/execution/index.js';

let seq = 0;
function makeMessage(overrides: Partial<MessageContext> = {}): MessageContext {
  seq++;
  return {
    channelId: 'telegram',
    senderId: 'contract-a',
    messageId: `ctest-${Date.now()}-${seq}`,
    messageType: 'text',
    content: `hello-${seq}`,
    timestamp: Date.now(),
    isDirectMessage: true,
    rawPayload: {},
    ...overrides,
  };
}

function allow(...senders: string[]) {
  return { policy: 'allowlist' as const, allowFrom: senders };
}

const okCoreAPI = () => ({
  chat: async () => ({ content: 'pong' }),
  chatStream: async function* () {
    yield { type: 'text', content: 'pong', sessionId: '' } as const;
    return { content: 'pong', finishReason: 'stop' };
  },
});

describe('R4 契约①：同一消息并发到达两次 ⇒ 只一次业务副作用', () => {
  it('并发同 messageId ⇒ chatStream 仅调用一次，第二次 inflight_skipped', async () => {
    let chatStreamCalls = 0;
    let releaseStream!: () => void;
    const gate = new Promise<void>((r) => (releaseStream = r));
    const coreAPI = {
      chat: async () => ({ content: 'x' }),
      chatStream: async function* () {
        chatStreamCalls++;
        await gate; // 阻塞首个调用，制造与第二次的重叠窗口
        yield { type: 'text', content: 'pong', sessionId: '' } as const;
        return { content: 'pong', finishReason: 'stop' };
      },
    };
    const msg = makeMessage({
      senderId: 'c1',
      messageId: `same-${Date.now()}`,
    });
    const opts = {
      coreAPI,
      channelName: 'telegram',
      dmPolicy: allow('c1'),
    };

    const first = routeChannelMessage(msg, opts);
    await new Promise((r) => setTimeout(r, 25)); // 令首个进入 claim + chatStream
    const second = await routeChannelMessage(msg, opts); // 同键 ⇒ inflight
    releaseStream();
    const firstResult = await first;

    expect(chatStreamCalls).toBe(1);
    expect(second.response).toBe('inflight_skipped');
    expect(firstResult.valid).toBe(true);
  });
});

describe('R4 契约②：取消/异常 ⇒ 不判成功、半成品不出站', () => {
  it('流中断 ⇒ fail（非 complete）且无出站', async () => {
    const mgr = getExecutionManager();
    mgr.reset();
    const failSpy = spyOn(mgr, 'fail');
    const completeSpy = spyOn(mgr, 'complete');
    const outbound: string[] = [];
    try {
      await expect(
        routeChannelMessage(makeMessage({ senderId: 'c2' }), {
          coreAPI: {
            chat: async () => ({ content: 'x' }),
            chatStream: async function* () {
              yield {
                type: 'text',
                content: 'partial',
                sessionId: '',
              } as const;
              throw new Error('network down');
            },
          },
          onOutbound: async (c) => {
            outbound.push(c);
          },
          channelName: 'telegram',
          dmPolicy: allow('c2'),
        })
      ).rejects.toThrow();

      expect(failSpy).toHaveBeenCalledTimes(1);
      expect(completeSpy).toHaveBeenCalledTimes(0);
      // 半成品（"partial"）**不得**作为成功回复出站
      expect(outbound.some((t) => t.includes('partial'))).toBe(false);
    } finally {
      failSpy.mockRestore();
      completeSpy.mockRestore();
      mgr.reset();
    }
  });
});

describe('R4 契约③：消费中断网 ⇒ 锁释放、允许重试', () => {
  it('首次抛错后，同 messageId 重路由应**再次真正处理**（非 duplicate/inflight）', async () => {
    const senderId = 'c3';
    const messageId = `net-${Date.now()}`;
    const opts = { channelName: 'telegram', dmPolicy: allow(senderId) };

    await expect(
      routeChannelMessage(makeMessage({ senderId, messageId }), {
        ...opts,
        coreAPI: {
          chat: async () => ({ content: 'x' }),
          chatStream: async function* () {
            throw new Error('ECONNRESET');
          },
        },
      })
    ).rejects.toThrow();

    let calls = 0;
    const retry = await routeChannelMessage(
      makeMessage({ senderId, messageId }),
      {
        ...opts,
        coreAPI: {
          chat: async () => ({ content: 'x' }),
          chatStream: async function* () {
            calls++;
            yield { type: 'text', content: 'ok', sessionId: '' } as const;
            return { content: 'ok', finishReason: 'stop' };
          },
        },
      }
    );

    expect(calls).toBe(1);
    expect(retry.valid).toBe(true);
    expect(retry.response).not.toBe('duplicate_skipped');
    expect(retry.response).not.toBe('inflight_skipped');
  });
});

describe('R4 契约④：出站恰好一次、抛错不自动重发', () => {
  it('成功 ⇒ onOutbound 调用恰好一次', async () => {
    let calls = 0;
    const r = await routeChannelMessage(makeMessage({ senderId: 'c4' }), {
      coreAPI: okCoreAPI(),
      onOutbound: async () => {
        calls++;
      },
      channelName: 'telegram',
      dmPolicy: allow('c4'),
    });
    expect(r.valid).toBe(true);
    expect(calls).toBe(1);
  });

  it('出站抛错 ⇒ 不自动重发（仍 1 次）且向上抛出', async () => {
    let calls = 0;
    await expect(
      routeChannelMessage(makeMessage({ senderId: 'c4b' }), {
        coreAPI: okCoreAPI(),
        onOutbound: async () => {
          calls++;
          throw new Error('send failed');
        },
        channelName: 'telegram',
        dmPolicy: allow('c4b'),
      })
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

describe('R4 契约⑤：帧校验失败 ⇒ 不进入后续业务阶段', () => {
  it('空 messageId ⇒ INVALID_ID 且不调用 chatStream', async () => {
    let called = false;
    const r = await routeChannelMessage(makeMessage({ messageId: '' }), {
      coreAPI: {
        chat: async () => ({ content: 'x' }),
        chatStream: async function* () {
          called = true;
          yield { type: 'text', content: 'x', sessionId: '' } as const;
          return { content: 'x', finishReason: 'stop' };
        },
      },
      channelName: 'telegram',
    });
    expect(r.valid).toBe(false);
    expect(r.errorCode).toBe('INVALID_ID');
    expect(called).toBe(false);
  });
});

describe('R4 契约⑥：不同账号相同 messageId ⇒ 不跨账号误去重', () => {
  it('同 messageId 由两个 sender 发出 ⇒ 两次都真正处理', async () => {
    const messageId = `shared-${Date.now()}`;
    let calls = 0;
    const coreAPI = {
      chat: async () => ({ content: 'x' }),
      chatStream: async function* () {
        calls++;
        yield { type: 'text', content: 'ok', sessionId: '' } as const;
        return { content: 'ok', finishReason: 'stop' };
      },
    };
    const opts = {
      coreAPI,
      channelName: 'telegram',
      dmPolicy: allow('acct-A', 'acct-B'),
    };

    const r1 = await routeChannelMessage(
      makeMessage({ senderId: 'acct-A', messageId }),
      opts
    );
    const r2 = await routeChannelMessage(
      makeMessage({ senderId: 'acct-B', messageId }),
      opts
    );

    expect(calls).toBe(2);
    expect(r1.response).not.toBe('inflight_skipped');
    expect(r2.response).not.toBe('inflight_skipped');
    expect(r2.response).not.toBe('duplicate_skipped');
  });
});
