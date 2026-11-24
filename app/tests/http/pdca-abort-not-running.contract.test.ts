// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2-E（2026-11-24，真机 `pdca_mwupjxor`）：`POST /v1/pdca/:id/abort` 在
 * **内存无在飞编排器** 时也必须让任务落终态。
 *
 * 原实现回 409 `not_running`，checkpoint 仍是 `phase=running/status=started`
 * ⇒ 用户点中止后任务一直显示运行中，直到下次启动扫描按 `startup_scan` 收口。
 * 现口径：就地写 `phase/status=abort, abortedBy=user_abort` + 同步 workitem +
 * 广播终态事件，响应标注 `checkpointOnly`。
 */

import { describe, expect, test, beforeEach, afterAll, spyOn } from 'bun:test';
import http from 'http';
import * as coreAPIModule from '../../src/runtime/api/CoreAPIImpl';
import * as handlerUtils from '../../src/infrastructure/http/handlers/handler-utils';

const TERMINAL_STATUS = new Set(['completed', 'failed', 'abort']);
const TERMINAL_PHASE = new Set(['completed', 'failed', 'abort']);
const ACTIVE_STATUS = new Set(['started', 'running']);

/** 先装 spy，再解析被测 handler */
const getCoreAPISpy = spyOn(coreAPIModule, 'getCoreAPI');
const broadcastSpy = spyOn(handlerUtils, 'broadcastEvent');

const { handlePdcaAbortTask, setPdcaAbortSettledHook } =
  await import('../../src/infrastructure/http/handlers/pdca-handlers');

type Ck = Record<string, unknown> & { taskId: string };
type SettledInput = { taskId: string; planId?: string; sessionId?: string };

let checkpoints: Map<string, Ck>;
let written: Array<{ taskId: string; patch: Record<string, unknown> }>;
let synced: string[];
let liveOrchestrators: Set<string>;
let settled: SettledInput[];

function installPort(): void {
  const port = {
    getPdcaStatusSets: async () => ({
      terminal: TERMINAL_STATUS,
      terminalPhases: TERMINAL_PHASE,
      active: ACTIVE_STATUS,
      awaitingApprovalPhases: new Set([
        'plan_pending',
        'stage_awaiting_approval',
      ]),
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
    syncPdcaWorkItemStatus: async (taskId: string) => {
      synced.push(taskId);
    },
    getPdcaOrchestrator: async (taskId: string) =>
      liveOrchestrators.has(taskId) ? { abort: async () => undefined } : null,
  };
  getCoreAPISpy.mockReturnValue({
    getTaskOpsPort: async () => port,
  } as never);
}

afterAll(() => {
  getCoreAPISpy.mockRestore();
  broadcastSpy.mockRestore();
});

beforeEach(() => {
  checkpoints = new Map();
  written = [];
  synced = [];
  liveOrchestrators = new Set();
  settled = [];
  broadcastSpy.mockClear();
  broadcastSpy.mockImplementation(() => undefined);
  // 入口装配的钩子（生产由 main.ts 装成 broadcastEvent）；测试装替身并断言
  setPdcaAbortSettledHook((input) => {
    settled.push(input as SettledInput);
  });
  getCoreAPISpy.mockReset();
  installPort();
});

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

async function abort(
  taskId: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const created = createRes();
  await handlePdcaAbortTask(
    {} as unknown as http.IncomingMessage,
    created.res,
    taskId
  );
  return created.read();
}

describe('P2-E：abort 在无在飞编排器时就地收口', () => {
  test('checkpoint 非终态 + 无编排器 ⇒ 200 + 落 abort 终态（user_abort）', async () => {
    checkpoints.set('pdca_no_loop', {
      taskId: 'pdca_no_loop',
      sessionId: 'sess-abort',
      planId: 'plan_1',
      phase: 'running',
      status: 'started',
      workItemId: 'wi_1',
    });

    const { status, body } = await abort('pdca_no_loop');

    expect(status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      taskId: 'pdca_no_loop',
      phase: 'abort',
      checkpointOnly: true,
    });
    expect(written).toHaveLength(1);
    expect(written[0].patch).toMatchObject({
      phase: 'abort',
      status: 'abort',
      abortedBy: 'user_abort',
    });
    expect(synced).toEqual(['pdca_no_loop']);
    // 终态通知必须触发，否则前端徽标/抽屉停留在"进行中"
    expect(settled).toEqual([
      {
        taskId: 'pdca_no_loop',
        planId: 'plan_1',
        sessionId: 'sess-abort',
        message: '用户中止',
      },
    ]);
  });

  test('无 workItemId ⇒ 不同步 workitem（不制造伪归属）', async () => {
    checkpoints.set('pdca_no_wi', {
      taskId: 'pdca_no_wi',
      sessionId: 'sess-abort',
      phase: 'running',
      status: 'started',
    });

    const { status } = await abort('pdca_no_wi');

    expect(status).toBe(200);
    expect(synced).toEqual([]);
  });

  test('已终态 ⇒ 409 already_terminal（不重复中止、不再写盘）', async () => {
    checkpoints.set('pdca_done', {
      taskId: 'pdca_done',
      sessionId: 'sess-abort',
      phase: 'completed',
      status: 'completed',
    });

    const { status, body } = await abort('pdca_done');

    expect(status).toBe(409);
    expect(body.error).toBe('already_terminal');
    expect(written).toHaveLength(0);
    expect(settled).toEqual([]);
  });

  test('无检查点 ⇒ 404', async () => {
    const { status, body } = await abort('pdca_missing');
    expect(status).toBe(404);
    expect(body.error).toBe('任务不存在');
  });

  test('有在飞编排器 ⇒ 走既有 abort 路径（不带 checkpointOnly）', async () => {
    checkpoints.set('pdca_live', {
      taskId: 'pdca_live',
      sessionId: 'sess-abort',
      phase: 'running',
      status: 'started',
    });
    liveOrchestrators.add('pdca_live');

    const { status, body } = await abort('pdca_live');

    expect(status).toBe(200);
    expect(body.checkpointOnly).toBeUndefined();
    expect(written).toHaveLength(1);
    expect(written[0].patch).toMatchObject({
      phase: 'abort',
      abortedBy: 'user_abort',
    });
  });
});
