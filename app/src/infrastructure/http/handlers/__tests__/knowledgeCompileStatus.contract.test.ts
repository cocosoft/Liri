// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `/v1/knowledge/compile-status` HTTP 契约测试（方案 B v7）
 *
 * 目的：前端 `useCompilePhaseStream` / `KnowledgePipelinePage` 直接消费该响应的
 * `sessionId / seq / phase / phases[]`，本测试锁定这条契约，防回归。
 *
 * 与 state machine 单测的分工：
 * - `knowledge/__tests__/compileProgressTracker.test.ts` 验证 tracker 内部行为
 * - 本文件验证 **handler 输出的 JSON 形状与取值**（即前端真正拿到的东西）
 *
 * 沙箱：沿用 knowledge-handlers 集成测试的做法（setUserDataDirOverride 到临时目录），
 * 避免污染真实用户数据目录。
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import http from 'node:http';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'node:path';
import { setUserDataDirOverride } from '@modules/core/paths';

const tempRoots: string[] = [];

interface MockResponse {
  res: http.ServerResponse;
  status: number;
  body: string;
  json: Record<string, unknown>;
}

function makeRes(): MockResponse {
  const state: { status: number; body: string } = { status: 200, body: '' };
  const res = {
    writeHead: (code: number) => {
      state.status = code;
    },
    end: (chunk?: unknown) => {
      if (chunk) state.body = String(chunk);
    },
    setHeader: () => {},
    getHeader: () => undefined,
  } as unknown as http.ServerResponse;
  return {
    res,
    get status() {
      return state.status;
    },
    get body() {
      return state.body;
    },
    get json() {
      return JSON.parse(state.body || '{}') as Record<string, unknown>;
    },
  };
}

async function callCompileStatus(): Promise<Record<string, unknown>> {
  const { handleKnowledgeCompileStatus } =
    await import('../knowledge-handlers');
  const mock = makeRes();
  await handleKnowledgeCompileStatus(
    {
      method: 'GET',
      url: '/v1/knowledge/compile-status',
    } as http.IncomingMessage,
    mock.res
  );
  expect(mock.status).toBe(200);
  return mock.json;
}

beforeAll(async () => {
  const tempHome = await mkdtemp(join(process.cwd(), '.kb-contract-home-'));
  tempRoots.push(tempHome);
  setUserDataDirOverride(tempHome);
}, 30000);

afterAll(async () => {
  setUserDataDirOverride(null);
  for (const root of tempRoots) {
    try {
      await rm(root, { recursive: true, force: true });
    } catch {
      // Windows EBUSY：best-effort 清理（残留临时目录无害）
    }
  }
});

describe('/v1/knowledge/compile-status 契约（v7）', () => {
  it('响应含既有 6 字段 + 新增 sessionId/seq/phase/phases', async () => {
    const { beginCompileSession } =
      await import('@modules/knowledge/CompileProgressTracker');
    beginCompileSession();
    const body = await callCompileStatus();

    // 既有字段（前端 operationProgressStore / useCompilePolling 依赖，不得改名）
    for (const k of [
      'status',
      'current',
      'total',
      'startedAt',
      'lastError',
      'result',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(body, k)).toBe(true);
    }
    // v7 新增字段
    expect(typeof body.sessionId).toBe('number');
    expect(typeof body.seq).toBe('number');
    expect(body.phase).toBeNull();
    const phases = body.phases as Array<Record<string, unknown>>;
    expect(Array.isArray(phases)).toBe(true);
    expect(phases.length).toBe(9);
    expect(phases.every((p) => p.status === 'pending')).toBe(true);
    expect(phases[0].phase).toBe('scanning');
    expect(phases[8].phase).toBe('indexing');
  }, 30000);

  it('阶段推进后 phase 与 phases[].detail 同步透出', async () => {
    const { enterPhase, updatePhaseDetail } =
      await import('@modules/knowledge/CompileProgressTracker');
    enterPhase('compiling', { current: 0, total: 10 });
    updatePhaseDetail(5, 10);

    const body = await callCompileStatus();
    expect(body.phase).toBe('compiling');
    expect(body.current).toBe(5);
    expect(body.total).toBe(10);
    const phases = body.phases as Array<Record<string, unknown>>;
    const compiling = phases.find((p) => p.phase === 'compiling');
    expect(compiling?.status).toBe('running');
    expect(compiling?.detail).toEqual({ current: 5, total: 10 });
  }, 30000);

  it('triggered 是独立终态：finish 后 indexing 仍为 triggered（G16 走 HTTP 契约）', async () => {
    const {
      completePhase,
      enterPhase,
      skipPhase,
      markTriggered,
      finishCompileSession,
    } = await import('@modules/knowledge/CompileProgressTracker');
    // 按生产顺序驱动（compile() 总会先走完 scanning → cleaning → compiling）
    completePhase(); // compiling（test 2 已 enter）
    enterPhase('scanning');
    completePhase();
    enterPhase('cleaning');
    completePhase();
    for (const p of [
      'linting',
      'graph_extract',
      'record_extract',
      'rule_extract',
      'chunk_refresh',
    ] as const) {
      skipPhase(p, 'gated');
    }
    enterPhase('indexing');
    markTriggered('indexing');
    finishCompileSession({
      compiled: 1,
      skipped: 0,
      errors: 2,
      errorSamples: ['boom-a', 'boom-b'],
    });

    const body = await callCompileStatus();
    expect(body.status).toBe('done');
    // 可观测性：错误样本随 result 一并透出（前端直接展示失败原因）
    const res = body.result as { errors: number; errorSamples?: string[] };
    expect(res.errors).toBe(2);
    expect(res.errorSamples).toEqual(['boom-a', 'boom-b']);
    const phases = body.phases as Array<Record<string, unknown>>;
    const indexing = phases.find((p) => p.phase === 'indexing');
    expect(indexing?.status).toBe('triggered');
    // 终态不得残留 pending/running（G17/G19/G20 共同判据）
    expect(
      phases.some((p) => p.status === 'pending' || p.status === 'running')
    ).toBe(false);
  }, 30000);
});
