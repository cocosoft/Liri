/**
 * 2026-11-11：消息级 `autonomy` 的跨字段冲突校验（接线级回归）
 *
 * 与 `updateSessionMeta`（PATCH /v1/sessions/:id/meta）同一契约：许愿式承诺"中途最多
 * 问一次"，与 `plan`（每步确认；收缩前的 ask / alwaysAsk 已并入）互斥。
 *
 * 本用例锁住**接线**（纯函数口径见 coreapi-session-meta.test.ts）：
 *  ① 请求把会话改成会冲突的组合 ⇒ **400**，且不进入 `coreAPI.chat`（不写 SSE 头）；
 *  ② 请求值与现值相同（历史脏组合）⇒ 放行，不把已有会话锁死；
 *  ③ 反向退出（demand → interactive）+ 收紧档 ⇒ 放行；
 *  ④ 请求不带 `autonomy` ⇒ 完全不受影响（普通聊天零成本、零校验）。
 */
import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type http from 'http';

import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import { readRequestBody } from '../../src/infrastructure/http/handlers/handler-utils';
import * as coreAPIModule from '../../src/runtime/api/CoreAPIImpl';

/** 假会话的 metadata（每个用例按需覆盖） */
let sessionMetadata: Record<string, unknown> = {};
/** 会话是否在内存里（`false` ⇒ 走持久层读取分支） */
let inMemory = true;
/** 持久层 metadata（`null` ⇒ 会话不存在） */
let storedMetadata: Record<string, unknown> | null = {};
/** `coreAPI.chat` 调用次数（应被 400 拦下时为 0） */
let chatCalls = 0;

const coreAPIStub = {
  chatManager: {
    canUseSession: async () => true,
    getSessions: () =>
      inMemory ? [{ id: 's-1', metadata: sessionMetadata }] : [],
    getSessionGateway: () => ({
      getSession: async () =>
        storedMetadata ? { id: 's-1', metadata: storedMetadata } : null,
    }),
  },
  chat: async () => {
    chatCalls += 1;
    return { content: 'ok', finishReason: 'stop' };
  },
};

const getCoreAPISpy = spyOn(coreAPIModule, 'getCoreAPI').mockReturnValue(
  coreAPIStub as never
);

afterAll(() => {
  getCoreAPISpy.mockRestore();
});

beforeEach(() => {
  sessionMetadata = {};
  inMemory = true;
  storedMetadata = {};
  chatCalls = 0;
});

const { handleChatCompletions } =
  await import('../../src/infrastructure/http/handlers/chat-handlers');

function makeReq(body: Record<string, unknown>): http.IncomingMessage {
  const bodyJson = JSON.stringify({
    messages: [{ role: 'user', content: 'hi' }],
    session_id: 's-1',
    model: 'm',
    ...body,
  });
  return {
    url: '/v1/chat/completions',
    headers: {},
    method: 'POST',
    on(event: string, cb: (arg?: unknown) => void) {
      if (event === 'data') cb(Buffer.from(bodyJson));
      if (event === 'end') queueMicrotask(() => cb());
      return this;
    },
  } as unknown as http.IncomingMessage;
}

function makeRes(): {
  res: http.ServerResponse;
  status: () => number;
  body: () => string;
} {
  const out = { status: 0, body: '' };
  const res = {
    writeHead: (code: number) => {
      out.status = code;
    },
    end: (chunk?: string) => {
      out.body = chunk ?? '';
    },
    on: () => undefined,
    write: () => true,
    socket: null,
  } as unknown as http.ServerResponse;
  return { res, status: () => out.status, body: () => out.body };
}

const ctx = {
  readRequestBody,
  broadcastEvent: () => {},
} as unknown as HandlerCtx;

describe('消息级 autonomy × 权限档冲突校验', () => {
  test('① 改成会冲突的组合 ⇒ 400，且不进入 chat', async () => {
    sessionMetadata = { permission_mode: 'plan' };
    const { res, status, body } = makeRes();

    await handleChatCompletions(ctx, makeReq({ autonomy: 'demand' }), res);

    expect(status()).toBe(400);
    expect(chatCalls).toBe(0);
    const payload = JSON.parse(body());
    expect(payload.error.code).toBe('AUTONOMY_PERMISSION_CONFLICT');
    expect(payload.error.message).toContain('demand');
    expect(payload.error.message).toContain('plan');
  });

  test('② 值未变（历史脏组合 demand × plan）⇒ 放行，不锁死会话', async () => {
    sessionMetadata = { autonomy: 'demand', permission_mode: 'plan' };
    const { res, status } = makeRes();

    await handleChatCompletions(ctx, makeReq({ autonomy: 'demand' }), res);

    expect(status()).toBe(200);
    expect(chatCalls).toBe(1);
  });

  test('③ 反向退出（demand → interactive）⇒ 放行', async () => {
    sessionMetadata = { autonomy: 'demand', permission_mode: 'plan' };
    const { res, status } = makeRes();

    await handleChatCompletions(ctx, makeReq({ autonomy: 'interactive' }), res);

    expect(status()).toBe(200);
    expect(chatCalls).toBe(1);
  });

  test('④ 请求不带 autonomy ⇒ 不受历史权限档影响', async () => {
    sessionMetadata = { permission_mode: 'plan' };
    const { res, status } = makeRes();

    await handleChatCompletions(ctx, makeReq({}), res);

    expect(status()).toBe(200);
    expect(chatCalls).toBe(1);
  });

  test('⑤ 合法组合（dontAsk / bypass 与 demand 共存）⇒ 放行', async () => {
    for (const mode of ['dontAsk', 'bypass'] as const) {
      sessionMetadata = { permission_mode: mode };
      chatCalls = 0;
      const { res, status } = makeRes();

      await handleChatCompletions(ctx, makeReq({ autonomy: 'demand' }), res);

      expect(status()).toBe(200);
      expect(chatCalls).toBe(1);
    }
  });

  test('⑥ 会话不在内存（冷会话）⇒ 读持久层 metadata 后同样拦截', async () => {
    inMemory = false;
    storedMetadata = { permission_mode: 'plan' };
    const { res, status, body } = makeRes();

    await handleChatCompletions(ctx, makeReq({ autonomy: 'demand' }), res);

    expect(status()).toBe(400);
    expect(chatCalls).toBe(0);
    expect(JSON.parse(body()).error.code).toBe('AUTONOMY_PERMISSION_CONFLICT');
  });

  test('⑦ 持久层也读不到会话 ⇒ 不误判冲突（交给既有 404 / 后续流程）', async () => {
    inMemory = false;
    storedMetadata = null;
    const { res, status } = makeRes();

    await handleChatCompletions(ctx, makeReq({ autonomy: 'demand' }), res);

    expect(status()).toBe(200);
    expect(chatCalls).toBe(1);
  });
});
