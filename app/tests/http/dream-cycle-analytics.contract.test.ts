// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * GET /v1/memory/dream/cycles/analytics 契约测试（3-4 v3 HTTP 端点）
 * 验证：列表 + 全量 stats（completed_at 口径）；status/triggerSource/limit 过滤；
 * 非法参数（status 非枚举/from NaN/limit 越界）由 handler 白名单忽略，不 4xx。
 * 隔离 LIRI_HOME（临时目录），先直写 dream_cycles 种子数据，再经 handler 端到端断言。
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type http from 'http';

// 隔离数据目录：必须先于任何 resolveDbPath 读取
process.env.LIRI_HOME = mkdtempSync(join(tmpdir(), 'dream-analytics-http-'));

const { getDreamCycleDb } = await import('../../src/dream/DreamCycleDb');
const { handleDreamCycleAnalytics } =
  await import('../../src/infrastructure/http/handlers/memory-handlers');

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

function makeReq(query = ''): http.IncomingMessage {
  const url = '/v1/memory/dream/cycles/analytics' + (query ? `?${query}` : '');
  return {
    url,
    headers: { host: 'localhost' },
  } as unknown as http.IncomingMessage;
}

const now = Date.now();
const day = 24 * 60 * 60 * 1000;
function mk(
  cycleId: string,
  status: string,
  source: string,
  ageMs: number,
  memories: number
) {
  return {
    cycleId,
    startedAt: now - ageMs - 60_000,
    completedAt: now - ageMs,
    triggerSource: source,
    status,
    sessionsScanned: 5,
    sessionsProcessed: 1,
    knowledgeFilesProcessed: 1,
    memoriesCreated: memories,
    memoriesRefined: 0,
    knowledgeFilesUpdated: 0,
    soulUpdated: false,
    userProfileUpdated: false,
    memoryCount: memories,
    processedSessionIds: ['s1'],
    processedKnowledgeFiles: [],
    insights: [],
    errors: [],
    soulConflicts: null,
    userConflicts: null,
  } as const;
}

async function call(query = '') {
  const created = createRes();
  await handleDreamCycleAnalytics(makeReq(query), created.res);
  return { status: created.status, body: JSON.parse(created.body) as any };
}

// 种子：cron completed(5) / cron failed(0) / manual partial(3)
const db = await getDreamCycleDb();
await db.upsertCycle(mk('c1', 'completed', 'cron', 1 * day, 5) as never);
await db.upsertCycle(mk('c2', 'failed', 'cron', 2 * day, 0) as never);
await db.upsertCycle(mk('c3', 'partial', 'manual', 3 * day, 3) as never);

describe('GET /v1/memory/dream/cycles/analytics 契约', () => {
  test('无参：3 行列表（completed_at DESC）+ 全量 stats', async () => {
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.cycles).toHaveLength(3);
    expect(body.cycles[0].cycleId).toBe('c1'); // 最新在前
    expect(body.stats.total).toBe(3);
    expect(body.stats.completed).toBe(1);
    expect(body.stats.partial).toBe(1);
    expect(body.stats.failed).toBe(1);
    expect(body.stats.byTriggerSource).toEqual({ cron: 2, manual: 1 });
    expect(body.stats.avgMemoriesCreated).toBe(4); // (5+3)/2，failed 不入均值
    expect(typeof body.cycles[0].createdAt).toBe('number'); // createdAt=startedAt
  });

  test('?status=failed → 1 行且 stats 随过滤', async () => {
    const { body } = await call('status=failed');
    expect(body.cycles).toHaveLength(1);
    expect(body.cycles[0].cycleId).toBe('c2');
    expect(body.stats.total).toBe(1);
    expect(body.stats.failed).toBe(1);
  });

  test('?triggerSource=manual&limit=1 → 1 行 manual', async () => {
    const { body } = await call('triggerSource=manual&limit=1');
    expect(body.cycles).toHaveLength(1);
    expect(body.cycles[0].triggerSource).toBe('manual');
  });

  test('非法参数不回 4xx：status=foo 忽略 / from=abc 忽略 / limit=0 回默认 / limit=9999 截上限', async () => {
    const s = await call('status=foo');
    expect(s.status).toBe(200);
    expect(s.body.cycles).toHaveLength(3); // 枚举白名单 → 忽略

    const f = await call('from=abc');
    expect(f.status).toBe(200);
    expect(f.body.cycles).toHaveLength(3); // NaN → 忽略

    const l0 = await call('limit=0');
    expect(l0.body.cycles).toHaveLength(3); // 回默认 50

    const lmax = await call('limit=9999');
    expect(lmax.status).toBe(200);
    expect(lmax.body.cycles).toHaveLength(3); // 截 500 ≥ 3
  });

  test('?from/to 按 completed_at 过滤', async () => {
    const { body } = await call(`from=${now - 2.5 * day}`);
    expect(body.cycles).toHaveLength(2); // c1,c2
    expect(body.stats.total).toBe(2);
  });
});
