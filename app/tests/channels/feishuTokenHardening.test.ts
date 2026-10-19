/**
 * 飞书 SDK 托管 token（2026-10-19，方案 B）
 *
 * 1. 出站走 SDK Client（Authorization 由 SDK 注入，本仓不再手写）；
 * 2. 401 / token 失效错误码：清空 SDK token 缓存后重试一次；
 * 3. 普通业务错误（如撤回目标）不重试。
 */
import { describe, expect, it } from 'bun:test';
import { createFeishuChannel } from '../../src/channels/feishu/FeishuChannel';

interface FakeClient {
  im: {
    message: {
      create: () => Promise<Record<string, unknown>>;
      reply: () => Promise<Record<string, unknown>>;
    };
  };
}

interface TokenTestSurface {
  appId: string;
  appSecret: string;
  sdkClient: FakeClient | null;
  tokenCache: { values: { clear: () => void } } | null;
  sendTextMessage(
    target: string,
    content: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }>;
  sendMessageWithFallback(params: {
    receiveId: string;
    receiveIdType: string;
    msgType: string;
    content: string;
    replyToMessageId?: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }>;
}

function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), {
    response: { status, data: { code: 99991663, msg: 'invalid token' } },
  });
}

function makePlugin(options: {
  create: () => Promise<Record<string, unknown>>;
  reply?: () => Promise<Record<string, unknown>>;
}): { plugin: TokenTestSurface; clearCalls: () => number } {
  const plugin = createFeishuChannel() as unknown as TokenTestSurface;
  plugin.appId = 'app-id';
  plugin.appSecret = 'app-secret';
  plugin.sdkClient = {
    im: {
      message: {
        create: options.create,
        reply: options.reply ?? (async () => ({ code: 0 })),
      },
    },
  };
  let clears = 0;
  plugin.tokenCache = {
    values: {
      clear: () => {
        clears++;
      },
    },
  };
  return { plugin, clearCalls: () => clears };
}

describe('飞书 SDK 托管 token：出站与重试', () => {
  it('正常发送 ⇒ 只调用一次，返回 messageId', async () => {
    let calls = 0;
    const { plugin, clearCalls } = makePlugin({
      create: async () => {
        calls++;
        return { code: 0, data: { message_id: 'om_1' } };
      },
    });

    const result = await plugin.sendTextMessage('ou_user', 'hi');

    expect(result).toEqual({ success: true, messageId: 'om_1' });
    expect(calls).toBe(1);
    expect(clearCalls()).toBe(0);
  });

  it('响应体 token 失效码 ⇒ 清缓存并重试一次', async () => {
    let calls = 0;
    const { plugin, clearCalls } = makePlugin({
      create: async () => {
        calls++;
        return calls === 1
          ? { code: 99991663, msg: 'invalid token' }
          : { code: 0, data: { message_id: 'om_2' } };
      },
    });

    const result = await plugin.sendTextMessage('ou_user', 'hi');

    expect(result).toEqual({ success: true, messageId: 'om_2' });
    expect(calls).toBe(2);
    expect(clearCalls()).toBe(1);
  });

  it('HTTP 401 ⇒ 清缓存并重试一次', async () => {
    let calls = 0;
    const { plugin, clearCalls } = makePlugin({
      create: async () => {
        calls++;
        if (calls === 1) throw httpError(401);
        return { code: 0, data: { message_id: 'om_3' } };
      },
    });

    const result = await plugin.sendTextMessage('ou_user', 'hi');

    expect(result).toEqual({ success: true, messageId: 'om_3' });
    expect(calls).toBe(2);
    expect(clearCalls()).toBe(1);
  });

  it('普通业务错误（如撤回目标）⇒ 不清缓存、不重试', async () => {
    let calls = 0;
    const { plugin, clearCalls } = makePlugin({
      create: async () => {
        calls++;
        return { code: 230011, msg: 'message withdrawn' };
      },
    });

    const result = await plugin.sendTextMessage('ou_user', 'hi');

    expect(result.success).toBe(false);
    expect(result.error).toBe('message withdrawn');
    expect(calls).toBe(1);
    expect(clearCalls()).toBe(0);
  });

  it('reply 目标撤回 ⇒ 回退为直接发送（SDK 路径保持不变）', async () => {
    let createCalls = 0;
    const { plugin } = makePlugin({
      create: async () => {
        createCalls++;
        return { code: 0, data: { message_id: 'om_direct' } };
      },
      reply: async () => ({ code: 230011, msg: 'message withdrawn' }),
    });

    const result = await plugin.sendMessageWithFallback({
      receiveId: 'ou_user',
      receiveIdType: 'open_id',
      msgType: 'text',
      content: '{"text":"hi"}',
      replyToMessageId: 'om_withdrawn',
    });

    expect(result).toEqual({ success: true, messageId: 'om_direct' });
    expect(createCalls).toBe(1);
  });
});
