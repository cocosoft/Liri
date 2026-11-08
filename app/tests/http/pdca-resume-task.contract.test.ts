// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `POST /v1/pdca/:taskId/resume` 契约测试（2026-11-08）
 *
 * 背景：终态回执会写「可 replan 续跑」，但该 HTTP 入口是**本轮新增**（此前
 * `handlePdcaResumeCheckpoint` 从未注册路由 ⇒ 用户照回执操作只会 404）。入口一旦存在，
 * 其**拒绝/幂等语义**就必须锁死，否则会把"等待审批"的任务白跑一遍、或让同一任务并行
 * 起两个循环（白烧 token）。
 *
 * 本测试只锁定 HTTP 层判定（不起 daemon / 不落 DB）：
 * - 无检查点 ⇒ 404；
 * - 待人工决策（`plan_pending` / `stage_awaiting_approval`）⇒ 409；
 * - 终态且不可 replan（`completed` / `abort` / `failed` 且 `replanPending=false`）⇒ 409；
 * - 可续跑 ⇒ 202 `resuming`，且**确实**调用了编排器一次；
 * - 在飞期间的重复调用 ⇒ 202 `already_resuming`（不并行起第二轮），结束后恢复可用。
 *
 * 隔离：与 `latestCheckpointSuspend.contract.test.ts` 同款 —— `spyOn(getCoreAPI)`
 * 返回最小 TaskOps 端口 stub；动态导入被测 handler（spy 生效后再解析）。
 */
import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type http from 'http';
import * as coreAPIModule from '../../src/runtime/api/CoreAPIImpl';

/** 每个用例前重置的检查点（`null` ⇒ 不存在） */
let checkpoint: Record<string, unknown> | null = null;
/** 编排器 `resumeFromCheckpoint` 收到的检查点（验证"确实续跑了一次"） */
let resumeCalls: Array<Record<string, unknown>> = [];
/** 续跑行为（默认立即完成；幂等用例改为挂起） */
let resumeBehavior: (
  ck: Record<string, unknown>
) => Promise<string> = async () => 'completed';
/** 内存编排器（`undefined` ⇒ 走 getOrCreate） */
let orchestrator: Record<string, unknown> | undefined;

function makeOrchestrator(): Record<string, unknown> {
  return {
    resumeFromCheckpoint: (ck: Record<string, unknown>) => {
      resumeCalls.push(ck);
      return resumeBehavior(ck);
    },
  };
}

const portStub = {
  readPdcaCheckpoint: async (_taskId: string) => checkpoint,
  getPdcaOrchestrator: async (_taskId: string) => orchestrator,
  getOrCreatePdcaOrchestrator: async (_taskId: string) => orchestrator,
  // 与桥接层同源的活跃状态集（"运行中不得续跑"判据）
  getPdcaStatusSets: async () => ({
    terminal: new Set(['completed', 'failed', 'abort']),
    terminalPhases: new Set(['completed', 'failed', 'abort']),
    active: new Set(['started', 'running', 'paused']),
    awaitingApprovalPhases: new Set([
      'plan_pending',
      'stage_awaiting_approval',
    ]),
  }),
};

const getCoreAPISpy = spyOn(coreAPIModule, 'getCoreAPI').mockReturnValue({
  getTaskOpsPort: async () => portStub,
} as never);

afterAll(() => {
  getCoreAPISpy.mockRestore();
});

beforeEach(() => {
  checkpoint = null;
  resumeCalls = [];
  resumeBehavior = async () => 'completed';
  orchestrator = makeOrchestrator();
});

// 动态导入：确保 spy 生效后再解析 handler（模块级 `getCoreAPI` 绑定）
const { handlePdcaResumeTask, shouldEmitStartFailureReceipt } =
  await import('../../src/infrastructure/http/handlers/pdca-handlers');

function makeRes(): {
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
    res,
    read: () => ({
      status: out.status,
      body: out.body ? (JSON.parse(out.body) as Record<string, unknown>) : {},
    }),
  };
}

async function call(taskId: string) {
  const { res, read } = makeRes();
  await handlePdcaResumeTask({} as http.IncomingMessage, res, taskId);
  return read();
}

/** 等一轮事件循环（让 `void promise.finally(...)` 的清理生效） */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('POST /v1/pdca/:taskId/resume — 入口判定', () => {
  test('无检查点 ⇒ 404，且不触发续跑', async () => {
    checkpoint = null;

    const r = await call('pdca_missing');
    expect(r.status).toBe(404);
    expect(
      String((r.body['error'] as { message?: string })?.message)
    ).toContain('任务不存在');
    expect(resumeCalls).toHaveLength(0);
  });

  test('等待人工决策（plan_pending）⇒ 409「请先审批」，不触发续跑', async () => {
    checkpoint = {
      taskId: 'pdca_pending',
      status: 'started',
      phase: 'plan_pending',
    };

    const r = await call('pdca_pending');
    expect(r.status).toBe(409);
    expect(String(r.body['error'])).toContain('等待人工决策');
    expect(r.body['phase']).toBe('plan_pending');
    expect(resumeCalls).toHaveLength(0);
  });

  test('等待人工决策（stage_awaiting_approval）⇒ 409，不触发续跑', async () => {
    checkpoint = {
      taskId: 'pdca_stage',
      status: 'started',
      phase: 'stage_awaiting_approval',
    };

    const r = await call('pdca_stage');
    expect(r.status).toBe(409);
    expect(String(r.body['error'])).toContain('等待人工决策');
    expect(resumeCalls).toHaveLength(0);
  });

  test('终态且不可 replan（completed）⇒ 409', async () => {
    checkpoint = {
      taskId: 'pdca_done',
      status: 'completed',
      phase: 'completed',
    };

    const r = await call('pdca_done');
    expect(r.status).toBe(409);
    expect(String(r.body['error'])).toContain('不可 replan');
    expect(r.body['replanPending']).toBe(false);
    expect(resumeCalls).toHaveLength(0);
  });

  test('failed 且 replanPending=false ⇒ 409（次数用尽后不再续跑）', async () => {
    checkpoint = {
      taskId: 'pdca_failed',
      status: 'failed',
      phase: 'execute',
      replanPending: false,
    };

    const r = await call('pdca_failed');
    expect(r.status).toBe(409);
    expect(resumeCalls).toHaveLength(0);
  });

  test('failed 且 replanPending=true ⇒ 202 resuming，并调用编排器一次', async () => {
    checkpoint = {
      taskId: 'pdca_replan',
      status: 'failed',
      phase: 'execute',
      replanPending: true,
    };

    const r = await call('pdca_replan');
    expect(r.status).toBe(202);
    expect(r.body['status']).toBe('resuming');
    expect(r.body['replanPending']).toBe(true);
    await tick();
    expect(resumeCalls).toHaveLength(1);
    expect(resumeCalls[0]?.['taskId']).toBe('pdca_replan');
  });

  test('续跑在飞期间的重复调用 ⇒ 202 already_resuming，结束后恢复可续跑', async () => {
    checkpoint = {
      taskId: 'pdca_inflight',
      status: 'failed',
      phase: 'execute',
      replanPending: true,
    };
    let release: (() => void) | undefined;
    resumeBehavior = () =>
      new Promise<string>((resolve) => {
        release = () => resolve('completed');
      });

    const first = await call('pdca_inflight');
    expect(first.status).toBe(202);
    expect(first.body['status']).toBe('resuming');

    const second = await call('pdca_inflight');
    expect(second.status).toBe(202);
    expect(second.body['status']).toBe('already_resuming');
    expect(resumeCalls).toHaveLength(1);

    release?.();
    await tick();
    // finally 已清理在飞标记 ⇒ 再次调用回到正常续跑分支
    const third = await call('pdca_inflight');
    expect(third.status).toBe(202);
    expect(third.body['status']).toBe('resuming');
    expect(resumeCalls).toHaveLength(2);
    release?.();
    await tick();
  });

  test('编排器不支持续跑（无 resumeFromCheckpoint）⇒ 501', async () => {
    checkpoint = {
      taskId: 'pdca_noport',
      status: 'failed',
      phase: 'execute',
      replanPending: true,
    };
    orchestrator = {};

    const r = await call('pdca_noport');
    expect(r.status).toBe(501);
    expect(resumeCalls).toHaveLength(0);
  });

  test('任务正在运行（检查点状态活跃 + 内存编排器存活）⇒ 409，不起第二个循环', async () => {
    checkpoint = {
      taskId: 'pdca_running',
      status: 'running',
      phase: 'execute',
    };

    const r = await call('pdca_running');
    expect(r.status).toBe(409);
    expect(String(r.body['error'])).toContain('正在运行');
    expect(resumeCalls).toHaveLength(0);
  });

  test('崩溃遗留（abortedBy=startup_scan）⇒ 202，允许续跑', async () => {
    checkpoint = {
      taskId: 'pdca_crash',
      status: 'abort',
      phase: 'abort',
      abortedBy: 'startup_scan',
      steps: [{ id: 's1', status: 'pending' }],
    };

    const r = await call('pdca_crash');
    expect(r.status).toBe(202);
    expect(r.body['status']).toBe('resuming');
    await tick();
    expect(resumeCalls).toHaveLength(1);
  });

  test('用户主动中止（phase=abort，无崩溃标记）⇒ 仍 409', async () => {
    checkpoint = {
      taskId: 'pdca_user_abort',
      status: 'abort',
      phase: 'abort',
      steps: [{ id: 's1', status: 'pending' }],
    };

    const r = await call('pdca_user_abort');
    expect(r.status).toBe(409);
    expect(String(r.body['error'])).toContain('不可 replan');
    expect(resumeCalls).toHaveLength(0);
  });
});

describe('启动路径异常回执判定（2026-11-08 真机 pdca_mw7eb8lt）', () => {
  test('中止态 ⇒ 不再补发「异常终止」（编排层已发 ⏹ 中止回执）', () => {
    expect(shouldEmitStartFailureReceipt({ phase: 'abort' })).toBe(false);
  });

  test('非中止态 / 无状态 ⇒ 仍补发（真实崩溃不静默）', () => {
    expect(shouldEmitStartFailureReceipt({ phase: 'execute' })).toBe(true);
    expect(shouldEmitStartFailureReceipt(undefined)).toBe(true);
    expect(shouldEmitStartFailureReceipt(null)).toBe(true);
  });
});
