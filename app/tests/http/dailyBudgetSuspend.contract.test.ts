/**
 * A2 契约测试（2026-10-12）：`GET /v1/cost/daily-budget/suspend` —— **只读**挂起清单。
 *
 * 覆盖（brief A2.4）：
 * - 空态：无挂起 ⇒ `{ sessions: [], count: 0 }`
 * - 有挂起：如实暴露 `sessionId/chain/suspendedAt/reason/expired/checkpointRef`
 * - >24h：`expired` 由协调器按 `SUSPEND_TTL_MS` 现算 ⇒ true
 * - 幂等只读：连续查询不改变登记
 * - 不受 `FEATURE_BUDGET_SUSPEND_RESUME` 门控（开关关时端点照常可用，清单自然为空）
 *
 * 隔离：只动内存协调器单例（`resetBudgetSuspendForTest`），不触磁盘/网络。
 */
import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import type http from 'http';
import { dispatchCostChannelRoutes } from '../../src/infrastructure/http/handlers/routes/cost-channel-routes';
import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import {
  getBudgetSuspendCoordinator,
  resetBudgetSuspendForTest,
  SUSPEND_TTL_MS,
} from '../../src/query/budgetSuspend';

function createReq(method: string, url: string): http.IncomingMessage {
  return { method, url } as unknown as http.IncomingMessage;
}

function createRes(): {
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
  const matched = await dispatchCostChannelRoutes(
    createReq(method, url),
    res,
    url,
    () => {},
    {} as HandlerCtx
  );
  return { ...read(), matched };
}

describe('GET /v1/cost/daily-budget/suspend（A2 只读挂起清单）', () => {
  let prevFlag: string | undefined;

  beforeEach(() => {
    prevFlag = process.env.FEATURE_BUDGET_SUSPEND_RESUME;
    delete process.env.FEATURE_BUDGET_SUSPEND_RESUME;
    resetBudgetSuspendForTest();
  });

  afterEach(() => {
    if (prevFlag === undefined)
      delete process.env.FEATURE_BUDGET_SUSPEND_RESUME;
    else process.env.FEATURE_BUDGET_SUSPEND_RESUME = prevFlag;
    resetBudgetSuspendForTest();
  });

  test('空态：无挂起 ⇒ 200 { sessions: [], count: 0 }（开关关时亦可用）', async () => {
    const r = await call('GET', '/v1/cost/daily-budget/suspend');
    expect(r.matched).toBe(true);
    expect(r.status).toBe(200);
    expect(r.body['sessions']).toEqual([]);
    expect(r.body['count']).toBe(0);
  });

  test('有挂起：如实暴露各字段，expired=false', async () => {
    getBudgetSuspendCoordinator().suspend({
      sessionId: 'sess-1',
      chain: 'stream',
      checkpointRef: 'cp-1',
      reason: 'daily_budget_exhausted',
    });

    const r = await call('GET', '/v1/cost/daily-budget/suspend');
    expect(r.status).toBe(200);
    expect(r.body['count']).toBe(1);
    const sessions = r.body['sessions'] as Array<Record<string, unknown>>;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]['sessionId']).toBe('sess-1');
    expect(sessions[0]['chain']).toBe('stream');
    expect(typeof sessions[0]['suspendedAt']).toBe('number');
    expect(sessions[0]['reason']).toBe('daily_budget_exhausted');
    expect(sessions[0]['expired']).toBe(false);
    expect(sessions[0]['checkpointRef']).toBe('cp-1');
  });

  test('>24h ⇒ expired=true（按 SUSPEND_TTL_MS 现算）', async () => {
    const coordinator = getBudgetSuspendCoordinator();
    const base = 1_000_000_000_000;
    const nowSpy = spyOn(Date, 'now').mockReturnValue(base);
    try {
      coordinator.suspend({
        sessionId: 'sess-old',
        chain: 'taor',
        reason: 'daily_budget_exhausted',
      });
    } finally {
      nowSpy.mockRestore();
    }
    // 快进到挂起后 24h + 1ms
    const futureSpy = spyOn(Date, 'now').mockReturnValue(
      base + SUSPEND_TTL_MS + 1
    );
    try {
      const r = await call('GET', '/v1/cost/daily-budget/suspend');
      const sessions = r.body['sessions'] as Array<Record<string, unknown>>;
      expect(sessions[0]['expired']).toBe(true);
      // checkpointRef 缺省 ⇒ 稳定为 null（形状一致）
      expect(sessions[0]['checkpointRef']).toBeNull();
    } finally {
      futureSpy.mockRestore();
    }
  });

  test('幂等只读：连续查询不改变登记', async () => {
    const coordinator = getBudgetSuspendCoordinator();
    coordinator.suspend({
      sessionId: 'sess-2',
      chain: 'stream',
      checkpointRef: 'cp-2',
      reason: 'daily_budget_exhausted',
    });
    const before = JSON.stringify(coordinator.list());

    const first = await call('GET', '/v1/cost/daily-budget/suspend');
    const second = await call('GET', '/v1/cost/daily-budget/suspend');

    expect(first.body).toEqual(second.body);
    expect(JSON.stringify(coordinator.list())).toBe(before);
    expect(coordinator.isSuspended('sess-2')).toBe(true);
  });

  test('非本路由 ⇒ matched=false', async () => {
    const r = await call('GET', '/v1/cost/daily-budget/other');
    expect(r.matched).toBe(false);
  });
});
