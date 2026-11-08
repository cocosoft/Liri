// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * PDCA 检查点「是否仍在生命周期内」的**单一判据**契约（2026-11-08）。
 *
 * 背景（真机取证）：`app.db.pdca_checkpoints` 里 `status IS NULL` 的存量行（649 条，
 * 横跨 63 个会话）被两个入口**反向解读**：
 * - `findExistingTask`：`status ∉ 终态集` ⇒ 视为进行中 ⇒ 同会话 `/start` 恒返回旧 taskId
 *   （会话幂等键永久锁死）；
 * - `scanAndAbortStalePdcaTasks`：要求 `status ∈ 活跃集` ⇒ 直接 `continue` ⇒ 永不清理。
 *
 * 修复后两处共用 `isCheckpointLive`：`phase` 或 `status` **任一**为终态即终态；
 * 缺省按非终态处理。本文件锁死这两个入口的行为。
 */

import { describe, expect, test, beforeEach, afterAll, spyOn } from 'bun:test';
import http from 'http';
import { Readable } from 'stream';
import * as coreAPIModule from '../../src/runtime/api/CoreAPIImpl';
import { inboxManager } from '@openliri/service/runtime/InboxManager';

const TERMINAL_STATUS = new Set(['completed', 'failed', 'abort']);
const TERMINAL_PHASE = new Set(['completed', 'failed', 'abort']);
const ACTIVE_STATUS = new Set(['started', 'running']);
const AWAITING_PHASES = new Set(['plan_pending', 'stage_awaiting_approval']);

/** 先装 spy，再解析被测 handler（spy 生效后才能替换掉 `getCoreAPI`） */
const getCoreAPISpy = spyOn(coreAPIModule, 'getCoreAPI');

const { handlePdcaStart, scanAndAbortStalePdcaTasks } =
  await import('../../src/infrastructure/http/handlers/pdca-handlers');

type Ck = Record<string, unknown> & { taskId: string };

let checkpoints: Map<string, Ck>;
let written: Array<{ taskId: string; patch: Record<string, unknown> }>;
let liveOrchestrators: Set<string>;
/** 收件箱 pending 卡（`source==='pdca'` 取 metadata.taskId，其余取 metadata.pdcaTaskId） */
let pendingCards: Array<{
  source: string;
  metadata: Record<string, unknown>;
}>;

function installPort(): void {
  const port = {
    getPdcaCheckpointIndex: async () => checkpoints,
    getPdcaStatusSets: async () => ({
      terminal: TERMINAL_STATUS,
      terminalPhases: TERMINAL_PHASE,
      active: ACTIVE_STATUS,
      awaitingApprovalPhases: AWAITING_PHASES,
    }),
    readPdcaCheckpoint: async (taskId: string) =>
      checkpoints.get(taskId) ?? null,
    writePdcaCheckpoint: async (
      taskId: string,
      patch: Record<string, unknown>
    ) => {
      written.push({ taskId, patch });
      const prev = checkpoints.get(taskId) ?? { taskId };
      checkpoints.set(taskId, { ...prev, ...patch } as Ck);
    },
    syncPdcaWorkItemStatus: async () => undefined,
    writePdcaWorkItem: async () => undefined,
    getPdcaOrchestrator: async (taskId: string) =>
      liveOrchestrators.has(taskId) ? { taskId } : null,
    getOrCreatePdcaOrchestrator: async () => ({
      runFullPdca: async () => undefined,
    }),
  };
  getCoreAPISpy.mockReturnValue({
    getTaskOpsPort: async () => port,
  } as never);
}

/** 收件箱读取替身：**绝不打真实库**（否则会把测试卡写进用户收件箱） */
const inboxListSpy = spyOn(inboxManager, 'list');

afterAll(() => {
  inboxListSpy.mockRestore();
  getCoreAPISpy.mockRestore();
});

beforeEach(() => {
  checkpoints = new Map();
  written = [];
  liveOrchestrators = new Set();
  pendingCards = [];
  inboxListSpy.mockImplementation(async () => ({
    items: pendingCards as never,
    total: pendingCards.length,
  }));
  getCoreAPISpy.mockReset();
  installPort();
});

function makeRawReq(raw: string): http.IncomingMessage {
  const req = new Readable({ read() {} }) as unknown as http.IncomingMessage & {
    headers: Record<string, string>;
  };
  req.headers = { host: 'localhost' };
  if (raw) req.push(raw);
  req.push(null);
  return req;
}

function createRes(): {
  res: http.ServerResponse;
  read: () => { status: number; body: Record<string, unknown> };
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
    read: () => ({
      status: out.status,
      body: JSON.parse(out.body) as Record<string, unknown>,
    }),
  };
}

/** 走 `/start` 的幂等键分支 */
async function start(
  sessionId: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const created = createRes();
  await handlePdcaStart(
    makeRawReq(JSON.stringify({ description: '判据一致性用例', sessionId })),
    created.res
  );
  return created.read();
}

describe('幂等键：`status IS NULL` 不再被当成"进行中"', () => {
  test('status=null + phase=failed ⇒ 视为终态，允许新建任务', async () => {
    checkpoints.set('pdca_old_failed', {
      taskId: 'pdca_old_failed',
      sessionId: 'sess-liveness',
      phase: 'failed',
      status: null,
    });

    const { status, body } = await start('sess-liveness');

    expect(status).toBe(202);
    expect(body.existing).toBeUndefined();
    expect(body.taskId).not.toBe('pdca_old_failed');
  });

  test('status=null + phase=running ⇒ 仍视为进行中（返回旧 taskId）', async () => {
    checkpoints.set('pdca_old_running', {
      taskId: 'pdca_old_running',
      sessionId: 'sess-liveness',
      phase: 'running',
      status: null,
    });

    const { status, body } = await start('sess-liveness');

    expect(status).toBe(200);
    expect(body.existing).toBe(true);
    expect(body.taskId).toBe('pdca_old_running');
  });

  test('phase=completed + status=completed ⇒ 允许新建任务（回归）', async () => {
    checkpoints.set('pdca_old_completed', {
      taskId: 'pdca_old_completed',
      sessionId: 'sess-liveness',
      phase: 'completed',
      status: 'completed',
    });

    const { status, body } = await start('sess-liveness');

    expect(status).toBe(202);
    expect(body.taskId).not.toBe('pdca_old_completed');
  });
});

describe('启动扫描：`status IS NULL` 不再被静默跳过', () => {
  test('status=null + phase=running ⇒ 落 abort（此前永不清理）', async () => {
    checkpoints.set('pdca_null_running', {
      taskId: 'pdca_null_running',
      sessionId: 'sess-scan',
      phase: 'running',
      status: null,
    });

    const result = await scanAndAbortStalePdcaTasks();

    expect(result.aborted).toBe(1);
    const patch = written.find((w) => w.taskId === 'pdca_null_running')?.patch;
    expect(patch?.phase).toBe('abort');
    expect(patch?.status).toBe('abort');
    expect(patch?.abortedBy).toBe('startup_scan');
  });

  test('status=null + 待审批 phase + **有 pending 卡** ⇒ 按可续跑保留（不 abort）', async () => {
    checkpoints.set('pdca_null_awaiting', {
      taskId: 'pdca_null_awaiting',
      sessionId: 'sess-scan',
      phase: 'stage_awaiting_approval',
      status: null,
    });
    // 步骤卡（`source='permission'`）用 metadata.pdcaTaskId 关联任务
    pendingCards.push({
      source: 'permission',
      metadata: { pdcaTaskId: 'pdca_null_awaiting' },
    });

    const result = await scanAndAbortStalePdcaTasks();

    expect(result.aborted).toBe(0);
    expect(result.resumable.map((r) => r.taskId)).toContain(
      'pdca_null_awaiting'
    );
    expect(written).toHaveLength(0);
  });

  // 2026-11-08（存量收口）：真机 95 条 `status='started'` 全部卡在这个形态 ——
  // 卡早已过期，收件箱零 pending ⇒ 任务永远无入口，却永久占住会话幂等键。
  test('待审批 + **无 pending 卡** ⇒ 按孤儿收口（abortedBy=orphan_scan）', async () => {
    checkpoints.set('pdca_orphan', {
      taskId: 'pdca_orphan',
      sessionId: 'sess-scan',
      phase: 'stage_awaiting_approval',
      status: 'started',
    });

    const result = await scanAndAbortStalePdcaTasks();

    expect(result.aborted).toBe(1);
    expect(result.resumable).toHaveLength(0);
    const patch = written.find((w) => w.taskId === 'pdca_orphan')?.patch;
    expect(patch?.phase).toBe('abort');
    expect(patch?.status).toBe('abort');
    expect(patch?.abortedBy).toBe('orphan_scan');
  });

  test('待审批 + 卡已过期（不在 pending 列表）⇒ 视为孤儿', async () => {
    checkpoints.set('pdca_expired_card', {
      taskId: 'pdca_expired_card',
      sessionId: 'sess-scan',
      phase: 'plan_pending',
      status: null,
    });
    // pending 列表里只有别的任务 ⇒ 本任务无卡可点
    pendingCards.push({
      source: 'permission',
      metadata: { pdcaTaskId: 'pdca_other' },
    });

    const result = await scanAndAbortStalePdcaTasks();

    expect(result.aborted).toBe(1);
    expect(written[0]?.patch.abortedBy).toBe('orphan_scan');
  });

  test('phase=failed + status=null ⇒ 已终态，既不 abort 也不计入可续跑', async () => {
    checkpoints.set('pdca_null_failed', {
      taskId: 'pdca_null_failed',
      sessionId: 'sess-scan',
      phase: 'failed',
      status: null,
    });

    const result = await scanAndAbortStalePdcaTasks();

    expect(result.aborted).toBe(0);
    expect(result.resumable).toHaveLength(0);
  });

  test('内存里有活跃编排器 ⇒ 跳过（启动竞态回归）', async () => {
    checkpoints.set('pdca_live', {
      taskId: 'pdca_live',
      sessionId: 'sess-scan',
      phase: 'running',
      status: 'running',
    });
    liveOrchestrators.add('pdca_live');

    const result = await scanAndAbortStalePdcaTasks();

    expect(result.aborted).toBe(0);
    expect(written).toHaveLength(0);
  });
});
