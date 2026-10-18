/**
 * U-13 / H-2：`GET /v1/monitor/orchestration` —— 编排链路 P50/P95 查询面（进程内）。
 *
 * 覆盖：
 * ① 路由分发命中 `/v1/monitor/orchestration`，未知路径不误吞；
 * ② 响应 200、`processLifetimeOnly: true` 与快照字段齐全；
 * ③ 真实的「起始事件 → 终止事件」配对后，可从响应里读出非零 P50/P95
 *    （证明它确实是可采样面，而不是只有空壳字段）。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import type http from 'http';
import { handleOrchestrationMetrics } from '../../src/infrastructure/http/handlers/monitoring-handlers.js';
import { dispatchMonitorCommandRoutes } from '../../src/infrastructure/http/handlers/routes/monitor-command-routes.js';
import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils.js';
import { globalEventBus } from '../../src/core/events/EventBus.js';
import { getOrchestrationMetrics } from '../../src/core/events/OrchestrationMetrics.js';
import { OrchestrationEventType as E } from '@modules/types/orchestrationEvents';

const ctx = {} as unknown as HandlerCtx;

interface Captured {
  res: http.ServerResponse;
  body: () => string;
  status: () => number;
}

function createRes(): Captured {
  const out = { body: '', status: 0 };
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
    body: () => out.body,
    status: () => out.status,
  };
}

function makeReq(method = 'GET'): http.IncomingMessage {
  return { method } as unknown as http.IncomingMessage;
}

/** 调一次处理器并返回解析后的 JSON */
async function requestOrchestration(): Promise<Record<string, unknown>> {
  const captured = createRes();
  await handleOrchestrationMetrics(ctx, makeReq(), captured.res);
  expect(captured.status()).toBe(200);
  return JSON.parse(captured.body()) as Record<string, unknown>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterAll(() => {
  // 单例订阅会跨用例存活：结束时停表并清空，避免污染同进程其它测试
  const metrics = getOrchestrationMetrics();
  metrics.stopTracking();
  metrics.reset();
});

describe('U-13 GET /v1/monitor/orchestration', () => {
  it('路由分发命中本端点，其它未知路径不被误吞', async () => {
    const captured = createRes();
    const matched = await dispatchMonitorCommandRoutes(
      makeReq(),
      captured.res,
      '/v1/monitor/orchestration',
      () => {},
      ctx
    );
    expect(matched).toBe(true);
    expect(captured.status()).toBe(200);

    const unmatched = await dispatchMonitorCommandRoutes(
      makeReq(),
      createRes().res,
      '/v1/monitor/__none__',
      () => {},
      ctx
    );
    expect(unmatched).toBe(false);
  });

  it('响应标注进程内来源，并带出快照字段', async () => {
    const data = await requestOrchestration();
    expect(data.source).toBe('in-process');
    expect(data.processLifetimeOnly).toBe(true);
    expect(typeof data.startTime).toBe('number');
    expect(typeof data.timestamp).toBe('number');
    expect(typeof data.totalEvents).toBe('number');
    expect(Array.isArray(data.events)).toBe(true);
  });

  it('起止事件配对后 P50/P95 可读出（确为可采样面）', async () => {
    const metrics = getOrchestrationMetrics();
    metrics.reset();

    globalEventBus.publish(E.PLAN_START, { planId: 'h2-plan' });
    await sleep(30);
    globalEventBus.publish(E.PLAN_COMPLETED, {
      planId: 'h2-plan',
      status: 'done',
    });

    const data = await requestOrchestration();
    const events = data.events as Array<Record<string, unknown>>;
    const planStart = events.find((e) => e.eventType === E.PLAN_START);
    expect(planStart).toBeDefined();
    expect(planStart!.count as number).toBeGreaterThanOrEqual(1);
    expect(planStart!.p50 as number).toBeGreaterThan(0);
    expect(planStart!.p95 as number).toBeGreaterThanOrEqual(
      planStart!.p50 as number
    );
  });
});
