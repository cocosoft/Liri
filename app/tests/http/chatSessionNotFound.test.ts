/**
 * 多租户 P3：聊天入口的 404 语义（接线级回归）
 *
 * 纯函数/单测只能证明 `canUseSession` 判得对；本用例锁住**接线**：
 *  ① `POST /v1/chat/completions`：会话不可用 ⇒ **404**，且不进入 `coreAPI.chat`；
 *  ② 同一入口在会话可用时照常放行（200，进入 `coreAPI.chat` 一次）；
 *  ③ `POST /v1/sessions/:id/resume`：不可用 ⇒ **404**，而不是先写 SSE 头（200）。
 *
 * 为什么必须是 404 而非 500：跨身份与"不存在"要**同一响应**，否则响应码本身就是探测信号。
 */
import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type http from 'http';

import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import { readRequestBody } from '../../src/infrastructure/http/handlers/handler-utils';
import * as coreAPIModule from '../../src/runtime/api/CoreAPIImpl';

/** 每次调用 `canUseSession` 的 sessionId（验证守卫确实执行） */
let checked: string[] = [];
/** `coreAPI.chat` 调用次数（不可用时应为 0） */
let chatCalls = 0;
/** 本次会话是否"可用" */
let sessionUsable = true;

const coreAPIStub = {
  chatManager: {
    canUseSession: async (sessionId: string) => {
      checked.push(sessionId);
      return sessionUsable;
    },
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
  checked = [];
  chatCalls = 0;
  sessionUsable = true;
});

const { handleChatCompletions, handleResumeChat } =
  await import('../../src/infrastructure/http/handlers/chat-handlers');

function makeReq(bodyJson: string): http.IncomingMessage {
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

const CHAT_BODY = JSON.stringify({
  messages: [{ role: 'user', content: 'hi' }],
  session_id: 's-cross',
  model: 'm',
});

describe('聊天入口 404 语义（P3）', () => {
  test('会话不可用 ⇒ 404 且不进入 chat', async () => {
    sessionUsable = false;
    const { res, status, body } = makeRes();

    await handleChatCompletions(ctx, makeReq(CHAT_BODY), res);

    expect(status()).toBe(404);
    expect(checked).toEqual(['s-cross']);
    expect(chatCalls).toBe(0);
    expect(JSON.parse(body()).error.type).toBe('not_found_error');
  });

  test('会话可用 ⇒ 照常放行（200，chat 调用一次）', async () => {
    const { res, status } = makeRes();

    await handleChatCompletions(ctx, makeReq(CHAT_BODY), res);

    expect(checked).toEqual(['s-cross']);
    expect(chatCalls).toBe(1);
    expect(status()).toBe(200);
  });

  test('恢复流：会话不可用 ⇒ 404（不写 SSE 头）', async () => {
    sessionUsable = false;
    const { res, status, body } = makeRes();

    await handleResumeChat(
      ctx,
      makeReq(JSON.stringify({ session_id: 's-cross', checkpoint_id: 'cp-1' })),
      res
    );

    expect(status()).toBe(404);
    expect(checked).toEqual(['s-cross']);
    expect(JSON.parse(body()).error.type).toBe('not_found_error');
  });
});
