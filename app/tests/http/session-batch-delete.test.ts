/**
 * POST /v1/sessions/batch-delete —— 按显式 id 列表批删契约（A′，2026-09-23）
 *
 * 锁定四件事：
 * ① 合法 ids ⇒ **逐个透传** CoreAPI.deleteSession（完整列表、顺序一致、无遗漏），
 *    200 且返回 `{ success: true, deleted, failed }`；
 * ② ids 缺失 / 空数组 / 非数组 / 元素非法 / 超 5000 ⇒ **400 且 stub 零调用**（绝不误删）；
 * ③ **部分失败不中断** —— 中间某个 id 抛错时其余仍被尝试，200 且如实计数；
 * ④ 全部失败 ⇒ 500 `{ error: { message: 'batch delete failed' } }`。
 *
 * 说明：**不使用 `mock.module`**（进程级副作用，bun 无法恢复，会污染同 worker 内其他
 * HTTP 测试）；改用 `spyOn(模块命名空间)` + `mockRestore`，并**动态导入**被测 handler
 * （静态 import 会被 ESM 提升，早于 spy 生效）。
 *
 * body 来源：被测 handler 走 `ctx.readRequestBody(req)`（真实实现 `readRequestBody` 订阅
 * `req.on('data'/'end')`），故 req 按该**真实消费契约**构造并投递 body。
 */

import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type http from 'http';
import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import { readRequestBody } from '../../src/infrastructure/http/handlers/handler-utils';
import * as coreAPIModule from '../../src/runtime/api/CoreAPIImpl';

/** stub 收到的 id 序列（每个用例前重置）；为空即"零调用" */
let attempted: string[] = [];
/** 令 stub 抛错的 id 集合（模拟单条删除失败） */
let failing = new Set<string>();

const coreAPIStub = {
  deleteSession: async (id: string): Promise<void> => {
    attempted.push(id);
    if (failing.has(id)) throw new Error(`delete failed: ${id}`);
  },
};

const getCoreAPISpy = spyOn(coreAPIModule, 'getCoreAPI').mockReturnValue(
  coreAPIStub as never
);

afterAll(() => {
  getCoreAPISpy.mockRestore();
});

beforeEach(() => {
  attempted = [];
  failing = new Set<string>();
});

// 动态导入：确保在 spy 生效之后再解析 handler（其静态 import 绑定到被替换的导出）
const { handleBatchDeleteSessions } =
  await import('../../src/infrastructure/http/handlers/session-handlers');

/**
 * 最小 req：按 `readRequestBody` 的真实消费方式（`req.on('data'/'end')`）提供 body。
 * `data` 同步投递（chunk 先入 chunks），`end` 用微任务推迟 —— 保证 resolve 时数据已就绪。
 */
function makeReq(bodyJson: string): http.IncomingMessage {
  return {
    url: '/v1/sessions/batch-delete',
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
  read: () => { status: number; body: Record<string, unknown> };
} {
  const out = { status: 0, body: '' };
  const res = {
    headersSent: false,
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

/** 最小 ctx：handler 用 `readRequestBody` 读 body + `broadcastEvent` 广播 */
const ctx = {
  readRequestBody,
  broadcastEvent: () => {},
} as unknown as HandlerCtx;

async function call(
  payload: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { res, read } = makeRes();
  await handleBatchDeleteSessions(ctx, makeReq(JSON.stringify(payload)), res);
  return read();
}

describe('POST /v1/sessions/batch-delete —— 按显式 id 列表批删（A′）', () => {
  test('合法 ids ⇒ 逐个透传（完整列表、顺序一致）并返回 200 与计数', async () => {
    const ids = ['sess-1', 'sess_2', 'A3'];

    const r = await call({ ids });

    expect(attempted).toEqual(ids);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, deleted: 3, failed: 0 });
  });

  test('ids 缺失 / 空数组 / 非数组 ⇒ 400 且 stub 零调用', async () => {
    const missing = await call({});
    expect(missing.status).toBe(400);

    const empty = await call({ ids: [] });
    expect(empty.status).toBe(400);

    const notArray = await call({ ids: 'sess-1' });
    expect(notArray.status).toBe(400);

    expect(attempted).toEqual([]);
  });

  test('元素非法（路径穿越 / 空串 / 非字符串）⇒ 400 且 stub 零调用', async () => {
    const traversal = await call({ ids: ['../../etc/passwd'] });
    expect(traversal.status).toBe(400);

    const emptyId = await call({ ids: [''] });
    expect(emptyId.status).toBe(400);

    const nonString = await call({ ids: ['ok-id', 42] });
    expect(nonString.status).toBe(400);

    expect(attempted).toEqual([]);
  });

  test('数组超 5000 ⇒ 400 且 stub 零调用', async () => {
    const ids = Array.from({ length: 5001 }, (_, i) => `s${i}`);

    const r = await call({ ids });

    expect(r.status).toBe(400);
    expect(attempted).toEqual([]);
  });

  test('部分失败：第 2 个抛错 ⇒ 200 且 deleted=2/failed=1（其余仍被尝试）', async () => {
    failing.add('sess-b');

    const r = await call({ ids: ['sess-a', 'sess-b', 'sess-c'] });

    expect(attempted).toEqual(['sess-a', 'sess-b', 'sess-c']);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, deleted: 2, failed: 1 });
  });

  test('全部失败 ⇒ 500 { error: { message: "batch delete failed" } }', async () => {
    failing = new Set(['sess-a', 'sess-b']);

    const r = await call({ ids: ['sess-a', 'sess-b'] });

    expect(attempted).toEqual(['sess-a', 'sess-b']);
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: { message: 'batch delete failed' } });
  });
});
