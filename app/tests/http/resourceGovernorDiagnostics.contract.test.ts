// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * GET /v1/diagnostics/resource-governor 契约测试
 *
 * 目的：`.trae/specs/default-off-switches-review-gates.md §2-#4` 的判据①
 * （`observedPeakInflight ≥ 8` 且撞限 ≥3 次）此前**无持久化出口**，只能靠 DEBUG 日志人工数；
 * 本端点把它变成可读读数。
 *
 * 钉住三件事：
 * ① **默认关也可读**（峰值/撞限与开关无关，零行为变更）；
 * ② `inflightCount`/`enabled` 如实反映开关（关 ⇒ 0 / false，不伪造）；
 * ③ 字段结构稳定（客户端/诊断脚本按名取数）。
 */

import { afterEach, describe, expect, test } from 'bun:test';
import type http from 'http';

import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';

const { handleResourceGovernorSnapshot } =
  await import('../../src/infrastructure/http/handlers/monitoring-handlers');
const { getResourceGovernor, resetResourceGovernorForTest } =
  await import('@modules/resourceGovernor');

const ENV = 'FEATURE_RESOURCE_GOVERNOR';
const ORIGINAL = process.env[ENV];

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env[ENV];
  else process.env[ENV] = ORIGINAL;
  resetResourceGovernorForTest();
});

const ctx = {} as unknown as HandlerCtx;
const req = {} as http.IncomingMessage;

function createRes(): {
  res: http.ServerResponse;
  body: string;
  status: number;
} {
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
    get body() {
      return out.body;
    },
    get status() {
      return out.status;
    },
  };
}

describe('GET /v1/diagnostics/resource-governor 契约', () => {
  test('默认关 ⇒ 200；峰值/撞限可读，inflightCount=0 且 enabled=false', async () => {
    delete process.env[ENV];
    resetResourceGovernorForTest(); // 隔离同进程其它用例留下的观测/在飞
    const gov = getResourceGovernor();
    const limit = gov.limit;
    // 造出 峰值 = limit+1 的观测（开关关 ⇒ 不登记在飞，但观测集照常维护）
    for (let i = 0; i <= limit; i++) {
      gov.admit({ sessionId: `s${i}`, priority: 'interactive' });
    }

    const created = createRes();
    await handleResourceGovernorSnapshot(ctx, req, created.res);
    expect(created.status).toBe(200);

    const data = JSON.parse(created.body) as Record<string, number | boolean>;
    expect(data.enabled).toBe(false);
    expect(data.limit).toBe(limit);
    expect(data.inflightCount).toBe(0);
    expect(data.observedPeakInflight).toBe(limit + 1);
    expect(data.observedLimitHits).toBe(2); // 第 limit、limit+1 次准入时各撞限一次
  });

  test('开关开 ⇒ enabled=true 且 inflightCount 反映当前在飞数', async () => {
    process.env[ENV] = 'true';
    resetResourceGovernorForTest();
    const gov = getResourceGovernor();
    gov.admit({ sessionId: 'a', priority: 'interactive' });
    gov.admit({ sessionId: 'b', priority: 'background' });

    const created = createRes();
    await handleResourceGovernorSnapshot(ctx, req, created.res);
    expect(created.status).toBe(200);

    const data = JSON.parse(created.body) as Record<string, number | boolean>;
    expect(data.enabled).toBe(true);
    expect(data.inflightCount).toBe(2);
    expect(data.observedPeakInflight).toBe(2);
  });
});
