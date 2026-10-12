/**
 * A1 契约测试（2026-10-12）：`GET /v1/sessions/:id/checkpoints/latest` 对**预算挂起检查点**的可见性。
 *
 * 背景（真实 E2E 实证）：会话在**轮首撞限**（尚未完成任何工具）时，`StreamingAutoCheckpoint.suspend`
 * 落的是**空消息快照** —— 真实载荷在 `metadata.budgetSuspend` / `pendingToolCalls` 上。而端点原先
 * 仅以「`messages.length > 0`」判可用 ⇒ 把一个真实挂起误报为 `checkpointAvailable:false`
 * （见 `.superpowers/sdd/budget-suspend-resume/progress.md` E2E 段与 spec §6.5 查询面缺口）。
 *
 * 修复口径：判据在**端点侧**区分 —— 带 `metadata.budgetSuspend` 标记者即使消息为空也**如实可见**；
 * `StreamingAutoCheckpoint.restore()` 的「可续跑」过滤键（`META_KEY='streamingAutoCheckpoint'`）**不变**。
 *
 * 隔离：与 `checkpoint-handlers.test.ts` 同款 —— 动态导入被测 handler（spy 生效后再解析）
 * + `spyOn(getCoreAPI)` 返回最小 chatManager stub。
 */
import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type http from 'http';
import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import * as coreAPIModule from '../../src/runtime/api/CoreAPIImpl';

/** 被测端点返回的检查点（每例前重置） */
let latestCheckpoint: unknown = null;

const chatManagerStub = {
  getLatestCheckpoint: async (_sessionId: string) => latestCheckpoint,
};

const getCoreAPISpy = spyOn(coreAPIModule, 'getCoreAPI').mockReturnValue({
  chatManager: chatManagerStub,
} as never);

afterAll(() => {
  getCoreAPISpy.mockRestore();
});

beforeEach(() => {
  latestCheckpoint = null;
});

// 动态导入：确保在 spy 生效之后再解析 handler
const { handleLatestCheckpoint } =
  await import('../../src/infrastructure/http/handlers/chat-handlers');

function makeReq(): http.IncomingMessage {
  return {
    url: '/v1/sessions/s1/checkpoints/latest',
    method: 'GET',
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

describe('GET /v1/sessions/:id/checkpoints/latest — 预算挂起检查点可见性（A1）', () => {
  test('挂起检查点（空消息 + metadata.budgetSuspend）⇒ checkpointAvailable:true 且如实暴露 label/metadata', async () => {
    latestCheckpoint = {
      id: 'cp-suspend',
      sessionId: 's1',
      label: 'budget_suspend',
      createdAt: 1,
      messages: [],
      metadata: {
        budgetSuspend: { suspendedAt: 111, reason: 'daily_budget_exhausted' },
        pendingToolCalls: [],
      },
      state: 'active',
      autoCreated: true,
    };

    const { res, read } = makeRes();
    await handleLatestCheckpoint({} as HandlerCtx, makeReq(), res, 's1');

    const r = read();
    expect(r.status).toBe(200);
    expect(r.body['checkpointAvailable']).toBe(true);
    expect(r.body['checkpointId']).toBe('cp-suspend');
    expect(r.body['label']).toBe('budget_suspend');
    expect(r.body['metadata']).toEqual({
      budgetSuspend: { suspendedAt: 111, reason: 'daily_budget_exhausted' },
      pendingToolCalls: [],
    });
  });

  test('普通空检查点（无 budgetSuspend 标记，空消息）⇒ 仍 checkpointAvailable:false（不误报）', async () => {
    latestCheckpoint = {
      id: 'cp-empty',
      sessionId: 's1',
      label: 'auto_step_0',
      createdAt: 1,
      messages: [],
      metadata: {},
      state: 'active',
      autoCreated: true,
    };

    const { res, read } = makeRes();
    await handleLatestCheckpoint({} as HandlerCtx, makeReq(), res, 's1');

    const r = read();
    expect(r.status).toBe(200);
    expect(r.body['checkpointAvailable']).toBe(false);
    expect(r.body['messages']).toEqual([]);
  });

  test('有消息的检查点 ⇒ checkpointAvailable:true（既有行为不变）', async () => {
    latestCheckpoint = {
      id: 'cp-msgs',
      sessionId: 's1',
      createdAt: 1,
      messages: [{ id: 'm1', role: 'user', content: 'hi' }],
      metadata: {},
      state: 'active',
      autoCreated: true,
    };

    const { res, read } = makeRes();
    await handleLatestCheckpoint({} as HandlerCtx, makeReq(), res, 's1');

    const r = read();
    expect(r.body['checkpointAvailable']).toBe(true);
    expect(r.body['checkpointId']).toBe('cp-msgs');
  });

  test('无检查点（null）⇒ checkpointAvailable:false', async () => {
    latestCheckpoint = null;

    const { res, read } = makeRes();
    await handleLatestCheckpoint({} as HandlerCtx, makeReq(), res, 's1');

    const r = read();
    expect(r.body['checkpointAvailable']).toBe(false);
    expect(r.body['messages']).toEqual([]);
  });
});
