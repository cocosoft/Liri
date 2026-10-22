/**
 * `POST /v1/commands/execute` 的会话上下文契约（2026-10-22）
 *
 * **缺陷现场**：handler 原先把 `commandExecutor.execute(command)` 的第二个参数（`context`）
 * 整个省略 ⇒ 会话级命令（`brief` 摘要）拿不到 `context.sessionId`，
 * `getSessionMessages(undefined)` 必然失败。而前端此前零调用方，所以一直没人发现。
 *
 * 本用例锁两件事：
 *  ① 请求体带 `session_id` ⇒ 透传给命令执行器；
 *  ② 不带 ⇒ 传 `undefined`（保持旧调用形态，不影响无会话命令）。
 */
import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type http from 'http';

import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import { readRequestBody } from '../../src/infrastructure/http/handlers/handler-utils';
import * as coreAPIModule from '../../src/runtime/api/CoreAPIImpl';

/** 每次执行的 (command, sessionId) */
let calls: Array<{ command: string; sessionId?: string }> = [];
/** 下一次执行返回的结果（用于覆盖两种返回形态） */
let nextResult: Record<string, unknown> = {
  success: true,
  value: 'ok',
  type: 'text',
};

const coreAPIStub = {
  getCommandsOpsPort: async () => ({
    listCommands: async () => [],
    executeCommand: async (command: string, sessionId?: string) => {
      calls.push({ command, sessionId });
      return nextResult;
    },
  }),
};

const spy = spyOn(coreAPIModule, 'getCoreAPI').mockReturnValue(
  coreAPIStub as never
);

afterAll(() => {
  spy.mockRestore();
});

beforeEach(() => {
  calls = [];
  nextResult = { success: true, value: 'ok', type: 'text' };
});

const { handleExecuteCommand } =
  await import('../../src/infrastructure/http/handlers/commands-handlers');

function makeReq(bodyJson: string): http.IncomingMessage {
  return {
    url: '/v1/commands/execute',
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

describe('POST /v1/commands/execute：session_id 透传', () => {
  test('带 session_id ⇒ 原样传给命令执行器', async () => {
    const { res, status, body } = makeRes();
    await handleExecuteCommand(
      ctx,
      makeReq(JSON.stringify({ command: 'brief', session_id: 's-42' })),
      res
    );

    expect(status()).toBe(200);
    expect(JSON.parse(body()).success).toBe(true);
    expect(calls).toEqual([{ command: 'brief', sessionId: 's-42' }]);
  });

  test('不带 session_id ⇒ 传 undefined（无会话命令不受影响）', async () => {
    const { res } = makeRes();
    await handleExecuteCommand(
      ctx,
      makeReq(JSON.stringify({ command: 'version' })),
      res
    );

    expect(calls).toEqual([{ command: 'version', sessionId: undefined }]);
  });

  test('缺 command ⇒ 400 且不触达执行器', async () => {
    const { res, status } = makeRes();
    await handleExecuteCommand(ctx, makeReq(JSON.stringify({})), res);

    expect(status()).toBe(400);
    expect(calls).toEqual([]);
  });

  test('`call` 形态的结果（data.value）也要透出，不能是空串', async () => {
    // brief / help 走 `call`，CommandManager 包成 { success, data: { type, value } }
    nextResult = {
      success: true,
      data: { type: 'text', value: '会话摘要：两条决策' },
    };
    const { res, status, body } = makeRes();

    await handleExecuteCommand(
      ctx,
      makeReq(JSON.stringify({ command: 'brief', session_id: 's-1' })),
      res
    );

    expect(status()).toBe(200);
    expect(JSON.parse(body()).output).toBe('会话摘要：两条决策');
  });
});

/**
 * BUG-17（2026-10-22）：命令级失败原因必须透出。
 *
 * 现场：handler 原先把 `error` 只按 `type === 'error'` 判定，而多数命令的失败形态是
 * `{ success:false, error:'…' }`（不带 type）⇒ error 被丢成空串，前端只能退化成通用文案。
 */
describe('POST /v1/commands/execute：命令级 error 透出', () => {
  test('success=false 且带 error（无 type）⇒ error 原样透出', async () => {
    nextResult = { success: false, error: '模型未配置，请先到模型管理添加' };
    const { res, status, body } = makeRes();

    await handleExecuteCommand(
      ctx,
      makeReq(JSON.stringify({ command: 'insights' })),
      res
    );

    const payload = JSON.parse(body());
    expect(status()).toBe(200);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('模型未配置，请先到模型管理添加');
  });

  test('type=error 且无 error 字段 ⇒ 沿用旧口径（output 即错误正文）', async () => {
    nextResult = {
      success: true,
      type: 'error',
      message: '无效的effort级别: x',
    };
    const { res, body } = makeRes();

    await handleExecuteCommand(
      ctx,
      makeReq(JSON.stringify({ command: 'effort x' })),
      res
    );

    const payload = JSON.parse(body());
    expect(payload.output).toBe('无效的effort级别: x');
    expect(payload.error).toBe('无效的effort级别: x');
  });

  test('成功且无 error ⇒ error 必须是空串（不误报）', async () => {
    nextResult = { success: true, value: 'ok', type: 'text' };
    const { res, body } = makeRes();

    await handleExecuteCommand(
      ctx,
      makeReq(JSON.stringify({ command: 'version' })),
      res
    );

    const payload = JSON.parse(body());
    expect(payload.success).toBe(true);
    expect(payload.error).toBe('');
  });
});
