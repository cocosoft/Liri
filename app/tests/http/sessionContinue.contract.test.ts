// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T3-12 契约测试（2026-10-13）：`POST /v1/sessions/:id/continue` —— **独立**长程继续入口。
//
// 语义（用户裁定「挂起后新增独立的『长程继续』入口/端点，不复用 relief 放行通道」）：
//  - 仅对 **guard** 挂起（熵门禁 / 轮上限）生效；budget 挂起仍走日预算放行（relief）；
//  - 未挂起 ⇒ 404；budget 挂起 ⇒ 409（拒绝，不成为 relief 旁路）；续跑失败 ⇒ 502；
//  - 幂等：成功后再调 ⇒ 条目已释放 ⇒ 404（不重复续跑）；
//  - 与既有 `POST /v1/sessions/:id/resume`（检查点重放）边界：本端点走协调器 release + 既有续跑通道。
//
// 隔离：`spyOn(getCoreAPI)` 返回最小 chatManager stub（同 latestCheckpointSuspend.contract.test.ts）。

import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type http from 'http';
import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import * as coreAPIModule from '../../src/runtime/api/CoreAPIImpl';
import {
  getBudgetSuspendCoordinator,
  resetBudgetSuspendForTest,
} from '../../src/query/budgetSuspend';

const FLAG = 'FEATURE_GUARD_SUSPEND';

/** 每次续跑调用的 (sessionId, chain) */
let resumeCalls: Array<[string, string]> = [];
/** resumeSuspendedSession 的返回值（每例前重置） */
let resumeResult = true;

const chatManagerStub = {
  resumeSuspendedSession: async (sessionId: string, chain: string) => {
    resumeCalls.push([sessionId, chain]);
    return resumeResult;
  },
};

const getCoreAPISpy = spyOn(coreAPIModule, 'getCoreAPI').mockReturnValue({
  chatManager: chatManagerStub,
} as never);

afterAll(() => {
  getCoreAPISpy.mockRestore();
});

beforeEach(() => {
  resumeCalls = [];
  resumeResult = true;
  resetBudgetSuspendForTest();
});

// 动态导入：确保在 spy 生效之后再解析 route 分发器
const { dispatchChatSessionRoutes } =
  await import('../../src/infrastructure/http/handlers/routes/chat-session-routes');

function createReq(method: string, url: string): http.IncomingMessage {
  return { method, url } as unknown as http.IncomingMessage;
}

function createRes(): {
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
    read: () => ({
      status: out.status,
      body: out.body ? (JSON.parse(out.body) as Record<string, unknown>) : {},
    }),
    res,
  };
}

async function call(
  method: string,
  url: string
): Promise<{
  status: number;
  body: Record<string, unknown>;
  matched: boolean;
}> {
  const { res, read } = createRes();
  const matched = await dispatchChatSessionRoutes(
    createReq(method, url),
    res,
    url,
    () => {},
    {} as HandlerCtx
  );
  return { ...read(), matched };
}

describe('POST /v1/sessions/:id/continue（T3-12 独立继续入口）', () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env[FLAG];
    process.env[FLAG] = 'true';
  });
  afterAll(() => {
    if (prev === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prev;
  });

  test('guard 挂起 + 续跑成功 ⇒ 200 { continued:true, chain }，条目释放', async () => {
    getBudgetSuspendCoordinator().suspend({
      sessionId: 'sess-1',
      chain: 'taor',
      reason: 'turn_limit',
      kind: 'guard',
    });

    const r = await call('POST', '/v1/sessions/sess-1/continue');
    expect(r.matched).toBe(true);
    expect(r.status).toBe(200);
    expect(r.body['continued']).toBe(true);
    expect(r.body['chain']).toBe('taor');
    expect(resumeCalls).toEqual([['sess-1', 'taor']]);
    expect(getBudgetSuspendCoordinator().isSuspended('sess-1')).toBe(false);
  });

  test('未挂起 ⇒ 404，不触发续跑', async () => {
    const r = await call('POST', '/v1/sessions/sess-none/continue');
    expect(r.matched).toBe(true);
    expect(r.status).toBe(404);
    expect(resumeCalls).toEqual([]);
  });

  test('budget 挂起 ⇒ 409（拒绝，不走续跑；不成为 relief 旁路）', async () => {
    getBudgetSuspendCoordinator().suspend({
      sessionId: 'sess-b',
      chain: 'taor',
      reason: 'daily_budget_exhausted',
    });

    const r = await call('POST', '/v1/sessions/sess-b/continue');
    expect(r.status).toBe(409);
    expect(resumeCalls).toEqual([]);
    expect(getBudgetSuspendCoordinator().isSuspended('sess-b')).toBe(true);
  });

  test('幂等：成功后再调 ⇒ 404（不重复续跑）', async () => {
    getBudgetSuspendCoordinator().suspend({
      sessionId: 'sess-2',
      chain: 'stream',
      reason: 'schema_entropy',
      kind: 'guard',
    });

    const first = await call('POST', '/v1/sessions/sess-2/continue');
    const second = await call('POST', '/v1/sessions/sess-2/continue');

    expect(first.status).toBe(200);
    expect(second.status).toBe(404);
    expect(resumeCalls).toEqual([['sess-2', 'stream']]);
  });

  test('续跑失败 ⇒ 502 且回滚为挂起（保留条目）', async () => {
    resumeResult = false;
    getBudgetSuspendCoordinator().suspend({
      sessionId: 'sess-3',
      chain: 'taor',
      reason: 'turn_limit',
      kind: 'guard',
    });

    const r = await call('POST', '/v1/sessions/sess-3/continue');
    expect(r.status).toBe(502);
    expect(getBudgetSuspendCoordinator().isSuspended('sess-3')).toBe(true);
  });

  test('开关关 ⇒ 404（零行为变更；即使存在 guard 挂起也不放行）', async () => {
    process.env[FLAG] = 'false';
    getBudgetSuspendCoordinator().suspend({
      sessionId: 'sess-4',
      chain: 'taor',
      reason: 'turn_limit',
      kind: 'guard',
    });
    const r = await call('POST', '/v1/sessions/sess-4/continue');
    expect(r.status).toBe(404);
    expect(resumeCalls).toEqual([]);
    expect(getBudgetSuspendCoordinator().isSuspended('sess-4')).toBe(true);
  });
});
