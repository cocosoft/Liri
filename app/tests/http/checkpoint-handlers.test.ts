/**
 * checkpoint HTTP handlers —— ChatManager 侧 6 端点契约（P1-10 测试盲区补齐，2026-10-05）
 *
 * 背景（spec `layer-inversion-service-app-app-ui.md` §3.3 ③ 遗留）：D-201 曾实测出
 * `createChatManager()` 是**工厂**（每次新实例）、`_chatSessions` 为**实例级** Map ⇒
 * 写端点必抛 `AppError 'Session not found' (1004)`；因「这 6 个端点**无任何测试覆盖**」
 * 该缺陷长期静默。本文件锁住 6 端点的**响应形状 + 取用面 + 错误承接**。
 *
 * 6 端点（与 spec 一致，5 写 1 读）：
 *  - POST   /v1/checkpoints                              `handleCreateCheckpoint`
 *  - GET    /v1/checkpoints/:id                          `handleGetCheckpoint`（读）
 *  - POST   /v1/checkpoints/:id/rollback                 `handleRollbackCheckpoint`
 *  - DELETE /v1/checkpoints/:id                          `handleDeleteCheckpoint`
 *  - POST   /v1/sessions/:id/checkpoints/latest          `handleSaveLatestCheckpoint`
 *  - DELETE /v1/sessions/:id/checkpoints/latest          `handleDeleteLatestCheckpoint`
 *
 * 说明：**不使用 `mock.module`**（进程级副作用，bun 无法恢复，会污染同 worker 内其他
 * HTTP 测试）；改用 `spyOn(模块命名空间)` + `mockRestore`，并**动态导入**被测 handler
 * （静态 import 会被 ESM 提升，早于 spy 生效）。
 */

import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type http from 'http';
import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import {
  readRequestBody,
  sendError,
} from '../../src/infrastructure/http/handlers/handler-utils';
import * as coreAPIModule from '../../src/runtime/api/CoreAPIImpl';

/** 记录 stub 收到的调用参数（每个用例前重置） */
type Calls = {
  createCheckpoint: Array<[string, string | undefined, unknown]>;
  rollbackToCheckpoint: string[];
  deleteCheckpoint: string[];
};
let calls: Calls = {
  createCheckpoint: [],
  rollbackToCheckpoint: [],
  deleteCheckpoint: [],
};

/** 令指定方法抛错（模拟底层失败 ⇒ 走 ctx.sendError） */
let throwOnCreate = false;

/** `listCheckpoints('')` 的返回值（`handleGetCheckpoint` 走它） */
let listedCheckpoints: Array<Record<string, unknown>> = [];
/** 兜底 `getCheckpoint?.(id)` 的返回值 */
let fallbackCheckpoint: unknown = undefined;
/** `getLatestCheckpoint(id)` 的返回值 */
let latestCheckpoint: {
  id: string;
  metadata?: Record<string, unknown>;
} | null = null;

const chatManagerStub = {
  createCheckpoint: async (
    sessionId: string,
    label?: string,
    metadata?: unknown
  ): Promise<string> => {
    if (throwOnCreate) throw new Error('session not found');
    calls.createCheckpoint.push([sessionId, label, metadata]);
    return 'cp-new';
  },
  listCheckpoints: async (_sessionId: string) => listedCheckpoints,
  getCheckpoint: async (_id: string) => fallbackCheckpoint,
  rollbackToCheckpoint: async (cpId: string): Promise<void> => {
    calls.rollbackToCheckpoint.push(cpId);
  },
  deleteCheckpoint: async (cpId: string): Promise<void> => {
    calls.deleteCheckpoint.push(cpId);
  },
  getLatestCheckpoint: async (_sessionId: string) => latestCheckpoint,
};

const getCoreAPISpy = spyOn(coreAPIModule, 'getCoreAPI').mockReturnValue({
  getChatManager: () => chatManagerStub,
} as never);

afterAll(() => {
  getCoreAPISpy.mockRestore();
});

beforeEach(() => {
  calls = {
    createCheckpoint: [],
    rollbackToCheckpoint: [],
    deleteCheckpoint: [],
  };
  throwOnCreate = false;
  listedCheckpoints = [];
  fallbackCheckpoint = undefined;
  latestCheckpoint = null;
});

// 动态导入：确保在 spy 生效之后再解析 handler（其静态 import 绑定到被替换的导出）
const {
  handleCreateCheckpoint,
  handleGetCheckpoint,
  handleRollbackCheckpoint,
  handleDeleteCheckpoint,
  handleSaveLatestCheckpoint,
  handleDeleteLatestCheckpoint,
} = await import('../../src/infrastructure/http/handlers/checkpoint-handlers');

/** 最小 req：`readRequestBody` 订阅 `req.on('data'/'end')`，按真实消费契约投递 body */
function makeReq(
  bodyJson = '',
  url = '/v1/checkpoints',
  method = 'POST'
): http.IncomingMessage {
  return {
    url,
    headers: {},
    method,
    on(event: string, cb: (arg?: unknown) => void) {
      if (event === 'data' && bodyJson) cb(Buffer.from(bodyJson));
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

/** 最小 ctx：`readRequestBody` + 真实 `sendError`（错误分支用） */
const ctx = {
  readRequestBody,
  sendError,
} as unknown as HandlerCtx;

describe('checkpoint HTTP handlers（P1-10 盲区补齐）', () => {
  test('handleCreateCheckpoint：透传 sessionId/label，200 返回 id', async () => {
    const { res, read } = makeRes();
    await handleCreateCheckpoint(
      ctx,
      makeReq(JSON.stringify({ sessionId: 's1', label: 'L' })),
      res
    );

    expect(calls.createCheckpoint).toEqual([['s1', 'L', undefined]]);
    expect(read()).toEqual({
      status: 200,
      body: { id: 'cp-new', sessionId: 's1', label: 'L' },
    });
  });

  test('handleCreateCheckpoint：底层抛错 ⇒ 500 api_error（不静默）', async () => {
    throwOnCreate = true;
    const { res, read } = makeRes();
    await handleCreateCheckpoint(
      ctx,
      makeReq(JSON.stringify({ sessionId: 's1', label: 'L' })),
      res
    );

    const r = read();
    expect(r.status).toBe(500);
    expect(r.body).toEqual({
      error: { message: 'session not found', type: 'api_error' },
    });
  });

  test('handleGetCheckpoint：命中列表 ⇒ 200 返回该检查点', async () => {
    listedCheckpoints = [
      { id: 'cp-1', label: 'a' },
      { id: 'cp-9', label: 'b' },
    ];
    const { res, read } = makeRes();
    await handleGetCheckpoint(
      ctx,
      makeReq('', '/v1/checkpoints/cp-9', 'GET'),
      res,
      'cp-9'
    );

    expect(read()).toEqual({
      status: 200,
      body: { id: 'cp-9', label: 'b' },
    });
  });

  test('handleGetCheckpoint：列表未命中 ⇒ 走 getCheckpoint 兜底', async () => {
    listedCheckpoints = [];
    fallbackCheckpoint = { id: 'cp-x', label: 'fallback' };
    const { res, read } = makeRes();
    await handleGetCheckpoint(
      ctx,
      makeReq('', '/v1/checkpoints/cp-x', 'GET'),
      res,
      'cp-x'
    );

    expect(read()).toEqual({
      status: 200,
      body: { id: 'cp-x', label: 'fallback' },
    });
  });

  test('handleGetCheckpoint：两处均无 ⇒ 404 Checkpoint not found', async () => {
    listedCheckpoints = [];
    fallbackCheckpoint = undefined;
    const { res, read } = makeRes();
    await handleGetCheckpoint(
      ctx,
      makeReq('', '/v1/checkpoints/none', 'GET'),
      res,
      'none'
    );

    expect(read()).toEqual({
      status: 404,
      body: { error: { message: 'Checkpoint not found' } },
    });
  });

  test('handleRollbackCheckpoint：透传 cpId，200 success', async () => {
    const { res, read } = makeRes();
    await handleRollbackCheckpoint(
      ctx,
      makeReq('', '/v1/checkpoints/cp-3/rollback'),
      res,
      'cp-3'
    );

    expect(calls.rollbackToCheckpoint).toEqual(['cp-3']);
    expect(read()).toEqual({
      status: 200,
      body: { success: true, checkpointId: 'cp-3' },
    });
  });

  test('handleDeleteCheckpoint：透传 cpId，200 success', async () => {
    const { res, read } = makeRes();
    await handleDeleteCheckpoint(
      ctx,
      makeReq('', '/v1/checkpoints/cp-4', 'DELETE'),
      res,
      'cp-4'
    );

    expect(calls.deleteCheckpoint).toEqual(['cp-4']);
    expect(read()).toEqual({
      status: 200,
      body: { success: true, checkpointId: 'cp-4' },
    });
  });

  test('handleSaveLatestCheckpoint：空 body ⇒ 默认 label=abort_*，200', async () => {
    const { res, read } = makeRes();
    await handleSaveLatestCheckpoint(
      ctx,
      makeReq(JSON.stringify({}), '/v1/sessions/s1/checkpoints/latest'),
      res,
      's1'
    );

    expect(calls.createCheckpoint).toHaveLength(1);
    const [sid, label, meta] = calls.createCheckpoint[0];
    expect(sid).toBe('s1');
    expect(String(label).startsWith('abort_')).toBe(true);
    expect(meta).toBeUndefined();
    expect(read()).toEqual({
      status: 200,
      body: { success: true, checkpointId: 'cp-new', sessionId: 's1' },
    });
  });

  test('handleSaveLatestCheckpoint：显式 label/metadata ⇒ 逐字透传', async () => {
    const { res, read } = makeRes();
    await handleSaveLatestCheckpoint(
      ctx,
      makeReq(
        JSON.stringify({
          label: 'L2',
          autoCreated: true,
          metadata: { abortRecovery: true },
        }),
        '/v1/sessions/s1/checkpoints/latest'
      ),
      res,
      's1'
    );

    expect(calls.createCheckpoint).toEqual([
      ['s1', 'L2', { abortRecovery: true }],
    ]);
    expect(read().status).toBe(200);
  });

  test('handleDeleteLatestCheckpoint：abortRecovery 标记 ⇒ 删除该检查点', async () => {
    latestCheckpoint = { id: 'cp-r', metadata: { abortRecovery: true } };
    const { res, read } = makeRes();
    await handleDeleteLatestCheckpoint(
      ctx,
      makeReq('', '/v1/sessions/s1/checkpoints/latest', 'DELETE'),
      res,
      's1'
    );

    expect(calls.deleteCheckpoint).toEqual(['cp-r']);
    expect(read()).toEqual({
      status: 200,
      body: { success: true, sessionId: 's1' },
    });
  });

  test('handleDeleteLatestCheckpoint：无标记 / 无检查点 ⇒ 不删除但仍 200', async () => {
    latestCheckpoint = { id: 'cp-n', metadata: {} };
    const first = makeRes();
    await handleDeleteLatestCheckpoint(
      ctx,
      makeReq('', '/v1/sessions/s1/checkpoints/latest', 'DELETE'),
      first.res,
      's1'
    );
    expect(calls.deleteCheckpoint).toEqual([]);
    expect(first.read().status).toBe(200);

    latestCheckpoint = null;
    const second = makeRes();
    await handleDeleteLatestCheckpoint(
      ctx,
      makeReq('', '/v1/sessions/s2/checkpoints/latest', 'DELETE'),
      second.res,
      's2'
    );
    expect(calls.deleteCheckpoint).toEqual([]);
    expect(second.read().status).toBe(200);
  });
});
