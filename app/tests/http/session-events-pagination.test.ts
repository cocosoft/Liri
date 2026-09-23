/**
 * GET /v1/sessions/:id/events —— 向前补页契约（P1-1，2026-09-22）
 *
 * 锁定三件事：
 * ① `beforeSeq` 被解析并**透传**到 CoreAPI（取"紧邻该点之前"的一页）；
 * ② `beforeSeq` 非法（≤0 / 非数）⇒ **400**，不落到 CoreAPI；
 * ③ 响应体透传 `hasEarlier`（与 `hasMore` 对称的"更早方向还有"信号）——
 *    前端 `TrajectoryStore.loadOlder` 的前置条件即由它驱动。
 *
 * 说明：**不使用 `mock.module`**（进程级副作用，bun 无法恢复，会污染同 worker 内其他
 * HTTP 测试）；改用 `spyOn(模块命名空间)` + `mockRestore`，并**动态导入**被测 handler
 * （静态 import 会被 ESM 提升，早于 spy 生效）。
 */

import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import type http from 'http';
import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import * as coreAPIModule from '../../src/runtime/api/CoreAPIImpl';

/** CoreAPI stub 收到的查询参数（每个用例前重置） */
let capturedQuery: Record<string, unknown> | null = null;

const coreAPIStub = {
  ensureSessionsLoaded: async (): Promise<void> => {},
  getSessionEvents: async (
    _sessionId: string,
    query?: Record<string, unknown>
  ): Promise<{
    events: unknown[];
    tailSeq: number;
    hasEarlier: boolean;
    hasMore: boolean;
  }> => {
    capturedQuery = query ?? null;
    return { events: [], tailSeq: 0, hasEarlier: true, hasMore: false };
  },
};

const getCoreAPISpy = spyOn(coreAPIModule, 'getCoreAPI').mockReturnValue(
  coreAPIStub as never
);

afterAll(() => {
  getCoreAPISpy.mockRestore();
});

// 动态导入：确保在 spy 生效之后再解析 handler（其静态 import 绑定到被替换的导出）
const { handleGetSessionEvents } =
  await import('../../src/infrastructure/http/handlers/session-handlers');

/** 最小 req：handler 只用 `url` / `headers.host` */
function makeReq(url: string): http.IncomingMessage {
  return {
    url,
    headers: { host: 'localhost' },
    method: 'GET',
  } as unknown as http.IncomingMessage;
}

function makeRes(): {
  res: http.ServerResponse;
  read: () => { status: number; body: Record<string, unknown> };
} {
  const out = { status: 0, body: '' };
  const res = {
    writeHead: (code: number) => {
      out.status = code;
    },
    end: (chunk?: string) => {
      out.body = chunk ?? '';
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    read: () => ({
      status: out.status,
      body: out.body ? (JSON.parse(out.body) as Record<string, unknown>) : {},
    }),
  };
}

const ctx = {} as HandlerCtx;

async function call(
  url: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  capturedQuery = null;
  const { res, read } = makeRes();
  await handleGetSessionEvents(ctx, makeReq(url), res, 'sess-1');
  return read();
}

describe('GET /v1/sessions/:id/events —— 向前补页（P1-1）', () => {
  test('beforeSeq 被解析并透传给 CoreAPI', async () => {
    const r = await call('/v1/sessions/sess-1/events?beforeSeq=500&limit=100');

    expect(r.status).toBe(200);
    expect(capturedQuery).toMatchObject({ beforeSeq: 500, limit: 100 });
  });

  test('响应透传 hasEarlier（驱动前端"加载更早"入口）', async () => {
    const r = await call('/v1/sessions/sess-1/events?beforeSeq=10');

    expect(r.status).toBe(200);
    expect(r.body['hasEarlier']).toBe(true);
    expect(r.body['hasMore']).toBe(false);
  });

  test('beforeSeq 非正 / 非数 ⇒ 400，且不调 CoreAPI', async () => {
    const zero = await call('/v1/sessions/sess-1/events?beforeSeq=0');
    expect(zero.status).toBe(400);
    expect(capturedQuery).toBeNull();

    const nan = await call('/v1/sessions/sess-1/events?beforeSeq=abc');
    expect(nan.status).toBe(400);
    expect(capturedQuery).toBeNull();
  });

  test('未传 beforeSeq 时保持既有语义（透传 undefined，不误加窗口）', async () => {
    const r = await call('/v1/sessions/sess-1/events?recent=1&limit=50');

    expect(r.status).toBe(200);
    expect(capturedQuery?.['beforeSeq']).toBeUndefined();
    expect(capturedQuery?.['recent']).toBe(true);
  });
});
