/**
 * 日 Token 限额 HTTP 端点契约测试（R16 / D3，2026-10-11）
 *
 * 覆盖：
 * - `GET  /v1/cost/daily-budget`：200 快照（默认上限/档位/剩余/kill switch）
 * - `PUT  /v1/cost/daily-budget`：200 热更新 + 持久化合并回写 + SSE；400（空/非法/坏 JSON）
 * - `POST /v1/cost/daily-budget/reset`：200 用量归零
 * - `POST /v1/cost/daily-budget/kill-switch`：true ⇒ locked；非布尔 ⇒ 400
 * - 非本路由 ⇒ matched=false
 *
 * 隔离：**不写真实数据目录**（不调用 `initDailyBudget` ⇒ 持久化未激活），
 * 且 spy `getConfigManager().setConfigValue` 拦截持久化写盘（仅断言调用参数）。
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

const CONFIG_KEY = 'costControl.dailyTokenBudget';
/** 债四 USD-2：USD 上限的**独立**持久化键（与 Token 键并列、互不替代） */
const USD_CONFIG_KEY = 'costControl.dailyBudgetUSD';

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
  delete process.env.LIRI_DAILY_BUDGET_USD;
  // 拦截持久化写盘（configManager 是 Proxy ⇒ spy 实例方法才能生效）
  setConfigSpy = spyOn(getConfigManager(), 'setConfigValue').mockImplementation(
    (() => {}) as never
  );
});

afterEach(() => {
  setConfigSpy.mockRestore();
  resetDailyBudgetForTest();
  delete process.env.LIRI_DAILY_BUDGET_TOKENS;
  delete process.env.LIRI_DAILY_BUDGET_USD;
});

async function call(
  method: string,
  url: string,
  jsonBody?: unknown,
  rawBody?: string
): Promise<{
  status: number;
  body: Record<string, unknown>;
  matched: boolean;
}> {
  const { res, read } = createRes();
  const matched = await dispatchCostChannelRoutes(
    createReq(method, url, jsonBody, rawBody),
    res,
    url,
    (event, data) => events.push([event, data]),
    {} as HandlerCtx
  );
  return { ...read(), matched };
}

describe('GET /v1/cost/daily-budget', () => {
  test('200：返回默认上限/档位/剩余/kill switch', async () => {
    const r = await call('GET', '/v1/cost/daily-budget');
    expect(r.matched).toBe(true);
    expect(r.status).toBe(200);
    expect(r.body['dailyLimit']).toBe(500_000);
    expect(r.body['mode']).toBe('normal');
    expect(r.body['todayUsed']).toBe(0);
    expect(r.body['remaining']).toBe(500_000);
    expect(r.body['killSwitch']).toBe(false);
    expect(typeof r.body['date']).toBe('string');
  });

  test('非本路由 ⇒ matched=false', async () => {
    const r = await call('GET', '/v1/cost/other');
    expect(r.matched).toBe(false);
  });
});

describe('PUT /v1/cost/daily-budget', () => {
  test('200：热更新上限 + 持久化合并回写 + 广播 SSE', async () => {
    const r = await call('PUT', '/v1/cost/daily-budget', { dailyLimit: 12345 });
    expect(r.status).toBe(200);
    expect(r.body['dailyLimit']).toBe(12345);
    // 立即生效（getMode 反映新上限）
    expect(getDailyBudget().getMode().dailyLimit).toBe(12345);
    // 持久化回写「合并后的生效配置」
    expect(setConfigSpy).toHaveBeenCalledTimes(1);
    expect(setConfigSpy.mock.calls[0]?.[0]).toBe(CONFIG_KEY);
    expect(setConfigSpy.mock.calls[0]?.[1]).toEqual({
      dailyLimit: 12345,
      warningThreshold: 0.8,
      lockThreshold: 1,
    });
    // 广播
    expect(events).toHaveLength(1);
    expect(events[0]?.[0]).toBe('cost:dailyBudgetUpdated');
  });

  test('200：仅更新阈值（不改上限），锁定阈值即时反映', async () => {
    getDailyBudget().recordUsage(300_000); // 60%
    const r = await call('PUT', '/v1/cost/daily-budget', {
      warningThreshold: 0.5,
      lockThreshold: 0.9,
    });
    expect(r.status).toBe(200);
    expect(r.body['dailyLimit']).toBe(500_000); // 未提供 ⇒ 保持
    expect(r.body['mode']).toBe('report_only'); // 60% ≥ 50% 且 < 90%
  });

  test('400：空 body（未提供任何字段）且不写配置', async () => {
    const r = await call('PUT', '/v1/cost/daily-budget', {});
    expect(r.status).toBe(400);
    expect(setConfigSpy).not.toHaveBeenCalled();
  });

  test('400：dailyLimit 非法（0 / 负数 / 小数）且不写配置', async () => {
    for (const bad of [0, -5, 1.5]) {
      const r = await call('PUT', '/v1/cost/daily-budget', { dailyLimit: bad });
      expect(r.status).toBe(400);
    }
    expect(setConfigSpy).not.toHaveBeenCalled();
  });

  test('400：阈值越界（0 / >1）', async () => {
    expect(
      (await call('PUT', '/v1/cost/daily-budget', { warningThreshold: 0 }))
        .status
    ).toBe(400);
    expect(
      (await call('PUT', '/v1/cost/daily-budget', { lockThreshold: 1.2 }))
        .status
    ).toBe(400);
  });

  test('400：坏 JSON', async () => {
    const r = await call(
      'PUT',
      '/v1/cost/daily-budget',
      undefined,
      '{not json'
    );
    expect(r.matched).toBe(true);
    expect(r.status).toBe(400);
  });
});

describe('POST /v1/cost/daily-budget/reset', () => {
  test('200：用量归零', async () => {
    getDailyBudget().recordUsage(1000);
    const r = await call('POST', '/v1/cost/daily-budget/reset');
    expect(r.status).toBe(200);
    expect(r.body['todayUsed']).toBe(0);
    expect(events).toHaveLength(1);
  });
});

describe('POST /v1/cost/daily-budget/kill-switch', () => {
  test('200：启用 ⇒ locked；停用 ⇒ normal', async () => {
    const on = await call('POST', '/v1/cost/daily-budget/kill-switch', {
      enabled: true,
    });
    expect(on.status).toBe(200);
    expect(on.body['killSwitch']).toBe(true);
    expect(on.body['mode']).toBe('locked');

    const off = await call('POST', '/v1/cost/daily-budget/kill-switch', {
      enabled: false,
    });
    expect(off.body['killSwitch']).toBe(false);
    expect(off.body['mode']).toBe('normal');
  });

  test('400：enabled 非布尔', async () => {
    const r = await call('POST', '/v1/cost/daily-budget/kill-switch', {
      enabled: 'yes',
    });
    expect(r.status).toBe(400);
  });
});

// ── 债四 USD-1 / USD-2（2026-10-13，方案 §6.3；`§12 Q-U3` 裁定）──
// 「USD 上限**由用户自主决策**」⇒ 代码内**不得出现任何默认值**：
// 未配置即 `limitUsd: null`（**不臆造 0** —— 0 会被误读为"上限=0 ⇒ 全额拒发"）。
describe('USD-1 GET /v1/cost/daily-budget：USD 只读字段', () => {
  test('未配置 ⇒ limitUsd 显式为 null、两本账为 0', async () => {
    const r = await call('GET', '/v1/cost/daily-budget');
    expect(r.status).toBe(200);
    expect(r.body['limitUsd']).toBeNull();
    expect(r.body['usedUsd']).toBe(0);
    expect(r.body['debtUsd']).toBe(0);
  });

  test('已配置 ⇒ limitUsd 与 getUsdState() 一致（金额允许小数）', async () => {
    await call('PUT', '/v1/cost/daily-budget', { dailyLimitUSD: 12.5 });
    const r = await call('GET', '/v1/cost/daily-budget');
    expect(r.body['limitUsd']).toBe(12.5);
    expect(r.body['limitUsd']).toBe(getDailyBudget().getUsdState().limitUsd);
  });

  test('记账后 usedUsd 与 getUsdState() 一致', async () => {
    getDailyBudget().recordUsdUsage(1.25);
    const r = await call('GET', '/v1/cost/daily-budget');
    expect(r.body['usedUsd']).toBe(1.25);
    expect(r.body['usedUsd']).toBe(getDailyBudget().getUsdState().usedUsd);
  });
});

describe('USD-2 PUT /v1/cost/daily-budget：写入 / 清空 USD 上限', () => {
  test('正数 ⇒ 即时生效 + 落**独立键** + 广播 SSE', async () => {
    const r = await call('PUT', '/v1/cost/daily-budget', {
      dailyLimitUSD: 12.5,
    });
    expect(r.status).toBe(200);
    expect(r.body['limitUsd']).toBe(12.5);
    expect(getDailyBudget().getUsdState().limitUsd).toBe(12.5);
    // 两个键：Token 合并配置 + USD 上限（并列、互不替代）
    expect(setConfigSpy).toHaveBeenCalledTimes(2);
    expect(setConfigSpy.mock.calls[0]?.[0]).toBe(CONFIG_KEY);
    expect(setConfigSpy.mock.calls[1]?.[0]).toBe(USD_CONFIG_KEY);
    expect(setConfigSpy.mock.calls[1]?.[1]).toBe(12.5);
    expect(events).toHaveLength(1);
    expect(events[0]?.[0]).toBe('cost:dailyBudgetUpdated');
  });

  test('null ⇒ 清空 = 解除（快照回 null，独立键写 null）', async () => {
    await call('PUT', '/v1/cost/daily-budget', { dailyLimitUSD: 5 });
    const r = await call('PUT', '/v1/cost/daily-budget', {
      dailyLimitUSD: null,
    });
    expect(r.status).toBe(200);
    expect(r.body['limitUsd']).toBeNull();
    expect(getDailyBudget().getUsdState().limitUsd).toBeUndefined();
    const last = setConfigSpy.mock.calls.at(-1);
    expect(last?.[0]).toBe(USD_CONFIG_KEY);
    expect(last?.[1]).toBeNull();
  });

  test('仅传 dailyLimitUSD ⇒ 200（Token 字段非必填）', async () => {
    const r = await call('PUT', '/v1/cost/daily-budget', { dailyLimitUSD: 3 });
    expect(r.status).toBe(200);
    expect(r.body['dailyLimit']).toBe(500_000); // Token 上限未动
  });

  test('非法值（0 / 负数 / 字符串）⇒ 400 且不写配置', async () => {
    for (const bad of [0, -1.5, 'abc']) {
      const r = await call('PUT', '/v1/cost/daily-budget', {
        dailyLimitUSD: bad,
      });
      expect(r.status).toBe(400);
    }
    expect(setConfigSpy).not.toHaveBeenCalled();
  });

  test('缺省 ⇒ 保持 USD 现值，且**不写** USD 键', async () => {
    await call('PUT', '/v1/cost/daily-budget', { dailyLimitUSD: 7 });
    setConfigSpy.mockClear();
    const r = await call('PUT', '/v1/cost/daily-budget', {
      dailyLimit: 600_000,
    });
    expect(r.status).toBe(200);
    expect(r.body['limitUsd']).toBe(7); // 现值保持
    expect(getDailyBudget().getUsdState().limitUsd).toBe(7);
    expect(setConfigSpy).toHaveBeenCalledTimes(1); // 只写 Token 键
    expect(setConfigSpy.mock.calls[0]?.[0]).toBe(CONFIG_KEY);
  });
});
