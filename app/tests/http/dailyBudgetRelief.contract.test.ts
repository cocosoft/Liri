/**
 * T5 契约测试（Spec `daily-budget-over-limit-ux.md` §5-B / §4 D-b/D-e）：
 * `POST /v1/cost/daily-budget/relief`（放行三件套）+ `GET` 暴露 `relief`/`debt`。
 *
 * 覆盖：
 * - 200：`boost` ⇒ 返回 `effectiveLimit`（上限×factor）并**生效**（`getMode` 反映）+ SSE 广播
 * - 400：非法参数 **fail-loud**（kind 非法 / factor 非正 / 空 body）
 * - 同 kind 重复 ⇒ **替换**并刷新到期时间（单一活动 relief）
 * - **硬锁优先**（Review Focus #5）：kill-switch 开启时 relief 照记（200）但 `mode` 仍 `locked`
 * - `GET` 暴露 `relief` / `debt`
 *
 * 隔离：与 `daily-budget-handlers.test.ts` 同款 —— 不调用 `initDailyBudget`（持久化未激活），
 * 且 spy `setConfigValue` 拦截配置写盘。
 */
import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import type http from 'http';
import { dispatchCostChannelRoutes } from '../../src/infrastructure/http/handlers/routes/cost-channel-routes';
import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import { getConfigManager } from '@modules/config';
import {
  getDailyBudget,
  resetDailyBudgetForTest,
} from '../../src/query/DailyBudgetManager';

/** 最小 req：仅满足 `readBody` 的 `data`/`end` 契约（注册 `end` 时才派发）。 */
function createReq(
  method: string,
  url: string,
  jsonBody?: unknown,
  rawBody?: string
): http.IncomingMessage {
  const payload =
    rawBody !== undefined
      ? rawBody
      : jsonBody === undefined
        ? ''
        : JSON.stringify(jsonBody);
  const handlers: Record<string, ((arg?: unknown) => void)[]> = {};
  return {
    method,
    url,
    on: (event: string, cb: (arg?: unknown) => void) => {
      (handlers[event] ??= []).push(cb);
      if (event === 'end') {
        queueMicrotask(() => {
          for (const handler of handlers['data'] ?? [])
            handler(Buffer.from(payload));
          for (const handler of handlers['end'] ?? []) handler();
        });
      }
    },
  } as unknown as http.IncomingMessage;
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

let events: Array<[string, unknown]>;
let setConfigSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  events = [];
  resetDailyBudgetForTest();
  delete process.env.LIRI_DAILY_BUDGET_TOKENS;
  setConfigSpy = spyOn(getConfigManager(), 'setConfigValue').mockImplementation(
    (() => {}) as never
  );
});

afterEach(() => {
  setConfigSpy.mockRestore();
  resetDailyBudgetForTest();
  delete process.env.LIRI_DAILY_BUDGET_TOKENS;
});

async function call(
  method: string,
  url: string,
  jsonBody?: unknown
): Promise<{
  status: number;
  body: Record<string, unknown>;
  matched: boolean;
}> {
  const { res, read } = createRes();
  const matched = await dispatchCostChannelRoutes(
    createReq(method, url, jsonBody),
    res,
    url,
    (event, data) => events.push([event, data]),
    {} as HandlerCtx
  );
  return { ...read(), matched };
}

describe('POST /v1/cost/daily-budget/relief（T5 放行端点）', () => {
  test('200：boost ⇒ effectiveLimit = 上限×factor，即时生效并广播 SSE', async () => {
    const r = await call('POST', '/v1/cost/daily-budget/relief', {
      kind: 'boost',
      factor: 2,
    });
    expect(r.matched).toBe(true);
    expect(r.status).toBe(200);
    const relief = r.body['relief'] as { kind: string; effectiveLimit: number };
    expect(relief.kind).toBe('boost');
    expect(relief.effectiveLimit).toBe(1_000_000);
    // 即时生效
    expect(getDailyBudget().getMode().dailyLimit).toBe(1_000_000);
    // 广播
    expect(events.map((e) => e[0])).toContain('cost:dailyBudgetUpdated');
  });

  test('GET 暴露 relief 与 debt（Spec §5-E 面板/卡片数据面）', async () => {
    const before = await call('GET', '/v1/cost/daily-budget');
    expect(before.body['relief']).toBeNull();
    expect(before.body['debt']).toBe(0);

    await call('POST', '/v1/cost/daily-budget/relief', {
      kind: 'unlock-today',
    });
    const after = await call('GET', '/v1/cost/daily-budget');
    const relief = after.body['relief'] as { kind: string };
    expect(relief.kind).toBe('unlock-today');
  });

  test('400：非法参数 fail-loud（空 body / kind 非法 / factor 非正）', async () => {
    expect(
      (await call('POST', '/v1/cost/daily-budget/relief', {})).status
    ).toBe(400);
    expect(
      (await call('POST', '/v1/cost/daily-budget/relief', { kind: 'nope' }))
        .status
    ).toBe(400);
    expect(
      (
        await call('POST', '/v1/cost/daily-budget/relief', {
          kind: 'boost',
          factor: -1,
        })
      ).status
    ).toBe(400);
    // 非法输入不得产生放行
    expect(getDailyBudget().getRelief()).toBeNull();
  });

  test('同 kind 重复 ⇒ 替换并刷新到期时间（单一活动 relief）', async () => {
    await call('POST', '/v1/cost/daily-budget/relief', {
      kind: 'boost',
      factor: 2,
      ttlMs: 60_000,
    });
    const first = getDailyBudget().getRelief()?.expiresAt ?? 0;

    await call('POST', '/v1/cost/daily-budget/relief', {
      kind: 'boost',
      factor: 3,
      ttlMs: 120_000,
    });
    const view = getDailyBudget().getRelief();
    expect(view?.expiresAt ?? 0).toBeGreaterThan(first);
    expect(getDailyBudget().getMode().dailyLimit).toBe(1_500_000);
  });

  test('硬锁优先：kill-switch 开启时 relief 照记（200）但 mode 仍 locked', async () => {
    await call('POST', '/v1/cost/daily-budget/kill-switch', { enabled: true });

    const r = await call('POST', '/v1/cost/daily-budget/relief', {
      kind: 'unlock-today',
    });
    expect(r.status).toBe(200);
    expect(getDailyBudget().getMode().mode).toBe('locked');
    expect(getDailyBudget().getRelief()?.effectiveLimit).toBe(2_500_000);
  });
});
