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

import { describe, expect, it, spyOn } from 'bun:test';
import type { MessageContext } from '../../src/channels/types/IChannel';
import {
  routeChannelMessage,
  validateInboundFrame,
} from '../../src/channels/routing/messageRouter';
import { getExecutionManager } from '../../src/execution/index.js';

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
  /**
   * 流式并轨（2026-08-20）：渠道消息主路径走 chatStream。
   * mock 产出 text chunk + generator return（最终 ChatResponse）。
   */
  chatStream: async function* chatStream() {
    yield { type: 'text', content: 'pong', sessionId: '' } as const;
    return { content: 'pong', finishReason: 'stop' };
  },
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
          chatStream: async function* () {
            yield { type: 'text', content: 'x', sessionId: '' } as const;
            return { content: 'x', finishReason: 'stop' };
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

describe('PR1 Execution 生命周期接线（2026-10-09）', () => {
  it('路由成功 ⇒ acquire + complete 各一次，结束后无残留执行', async () => {
    const mgr = getExecutionManager();
    mgr.reset();
    const acquireSpy = spyOn(mgr, 'acquire');
    const completeSpy = spyOn(mgr, 'complete');
    const failSpy = spyOn(mgr, 'fail');
    try {
      const result = await routeChannelMessage(
        makeMessage({ senderId: 'approved-user' }),
        {
          coreAPI: chatStub,
          channelName: 'telegram',
          dmPolicy: { policy: 'allowlist', allowFrom: ['approved-user'] },
        }
      );
      expect(result.valid).toBe(true);
      expect(acquireSpy).toHaveBeenCalledTimes(1);
      expect(completeSpy).toHaveBeenCalledTimes(1);
      expect(failSpy).toHaveBeenCalledTimes(0);
      // 记账结束（终态记录已释放）——纯记账、不改变路由既有返回值
      const firstResult = acquireSpy.mock.results[0] as {
        value?: ReturnType<typeof mgr.acquire>;
      };
      const lease = firstResult.value!;
      expect(mgr.get(lease.executionId)).toBeUndefined();
    } finally {
      acquireSpy.mockRestore();
      completeSpy.mockRestore();
      failSpy.mockRestore();
      mgr.reset();
    }
  });
});

describe('PR2 AbortSignal 端到端贯通（2026-10-09）', () => {
  it('Router 向 chatStream 注入取消信号（AbortSignal，初始未中止）', async () => {
    let capturedSignal: AbortSignal | undefined;
    await routeChannelMessage(makeMessage({ senderId: 'pr2a' }), {
      coreAPI: {
        chat: async () => ({ content: 'x' }),
        chatStream: async function* (...args: unknown[]) {
          capturedSignal = (args[0] as { signal?: AbortSignal }).signal;
          yield { type: 'text', content: 'pong', sessionId: '' } as const;
          return { content: 'pong', finishReason: 'stop' };
        },
      },
      channelName: 'telegram',
      dmPolicy: { policy: 'allowlist', allowFrom: ['pr2a'] },
    });
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);
  });
});

describe('PR5-S3 tool_calls 记账接线（2026-10-09）', () => {
  it('tool_call chunk（running → completed）⇒ recordToolCall / settleToolCall 各一次', async () => {
    const mgr = getExecutionManager();
    mgr.reset();
    const recordSpy = spyOn(mgr, 'recordToolCall');
    const settleSpy = spyOn(mgr, 'settleToolCall');
    try {
      await routeChannelMessage(makeMessage({ senderId: 'pr5a' }), {
        coreAPI: {
          chat: async () => ({ content: 'x' }),
          chatStream: async function* () {
            yield {
              type: 'tool_call',
              content: '',
              toolCall: {
                id: 'call-1',
                name: 'BashTool',
                arguments: {},
                status: 'running',
              },
              sessionId: '',
            } as const;
            yield {
              type: 'tool_call',
              content: '',
              toolCall: {
                id: 'call-1',
                name: 'BashTool',
                arguments: {},
                status: 'completed',
              },
              sessionId: '',
            } as const;
            yield { type: 'text', content: 'done', sessionId: '' } as const;
            return { content: 'done', finishReason: 'stop' };
          },
        },
        channelName: 'telegram',
        dmPolicy: { policy: 'allowlist', allowFrom: ['pr5a'] },
      });
      expect(recordSpy).toHaveBeenCalledTimes(1);
      expect(settleSpy).toHaveBeenCalledTimes(1);
      expect(settleSpy.mock.calls[0][3]).toBe('completed');
    } finally {
      recordSpy.mockRestore();
      settleSpy.mockRestore();
      mgr.reset();
    }
  });
});

describe('PR2 遗留-2 Router 级准入（2026-10-09）', () => {
  it('会话被占用（本执行 QUEUED）⇒ 不启动 LLM，返回 SESSION_BUSY', async () => {
    const prevFlag = process.env.FEATURE_EXECUTION_TWO_PHASE_CANCEL;
    const prevWait = process.env.SESSION_ADMISSION_WAIT_MS;
    process.env.FEATURE_EXECUTION_TWO_PHASE_CANCEL = 'true';
    process.env.SESSION_ADMISSION_WAIT_MS = '60';
    const mgr = getExecutionManager();
    mgr.reset();
    const blocker = mgr.acquire('pr2adm', 'm0'); // 占用该会话（RUNNING，不释放）
    let chatStreamCalled = false;
    try {
      const result = await routeChannelMessage(
        makeMessage({ senderId: 'pr2adm' }),
        {
          coreAPI: {
            chat: async () => ({ content: 'x' }),
            chatStream: async function* () {
              chatStreamCalled = true;
              yield { type: 'text', content: 'x', sessionId: '' } as const;
              return { content: 'x', finishReason: 'stop' };
            },
          },
          channelName: 'telegram',
          dmPolicy: { policy: 'allowlist', allowFrom: ['pr2adm'] },
        }
      );
      // 验收 ⑤：E2 **不能起** —— 未启动 LLM
      expect(chatStreamCalled).toBe(false);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('SESSION_BUSY');
    } finally {
      blocker.release();
      mgr.reset();
      if (prevFlag === undefined)
        delete process.env.FEATURE_EXECUTION_TWO_PHASE_CANCEL;
      else process.env.FEATURE_EXECUTION_TWO_PHASE_CANCEL = prevFlag;
      if (prevWait === undefined) delete process.env.SESSION_ADMISSION_WAIT_MS;
      else process.env.SESSION_ADMISSION_WAIT_MS = prevWait;
    }
  });
});

describe('PR4 内容去重会话维度（2026-10-09）', () => {
  it('⑧ 不同会话同人同文（5s 内）⇒ 不去重', async () => {
    const content = `dup-cross-${Date.now()}`;
    const r1 = await routeChannelMessage(
      makeMessage({ senderId: 'p4a', content, conversationId: 'conv-A' }),
      {
        coreAPI: chatStub,
        channelName: 'telegram',
        dmPolicy: { policy: 'allowlist', allowFrom: ['p4a'] },
      }
    );
    const r2 = await routeChannelMessage(
      makeMessage({ senderId: 'p4a', content, conversationId: 'conv-B' }),
      {
        coreAPI: chatStub,
        channelName: 'telegram',
        dmPolicy: { policy: 'allowlist', allowFrom: ['p4a'] },
      }
    );
    expect(r1.response).not.toBe('duplicate_skipped');
    expect(r2.response).not.toBe('duplicate_skipped');
  });

  it('同一会话同人同文（5s 内）⇒ 仍然去重（既有行为保持）', async () => {
    const content = `dup-same-${Date.now()}`;
    const r1 = await routeChannelMessage(
      makeMessage({ senderId: 'p4b', content, conversationId: 'conv-C' }),
      {
        coreAPI: chatStub,
        channelName: 'telegram',
        dmPolicy: { policy: 'allowlist', allowFrom: ['p4b'] },
      }
    );
    const r2 = await routeChannelMessage(
      makeMessage({ senderId: 'p4b', content, conversationId: 'conv-C' }),
      {
        coreAPI: chatStub,
        channelName: 'telegram',
        dmPolicy: { policy: 'allowlist', allowFrom: ['p4b'] },
      }
    );
    expect(r1.response).not.toBe('duplicate_skipped');
    expect(r2.response).toBe('duplicate_skipped');
  });
});
