// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `POST /v1/pdca/:taskId/step/:stepId/{review,decide}` 契约（2026-11-07 真机修复）。
 *
 * 缺陷（真机 `pdca_mw6f842k`）：
 *   ① `decide` 把请求体 `decision` 原样透传 —— 非法值（实测 `bogus`）被写进
 *      `plan.steps[].decision`，接口仍回 `200 {ok:true}`（假成功 + 状态污染）；
 *   ② 编排器未装载时回 `200 {error:'Not available'}`，调用方无法区分成功与没做事。
 *
 * 现口径：非法/缺失 decision ⇒ 400；任务未装载（不存在）⇒ 404；真正执行 ⇒ 200。
 * 隔离 `LIRI_HOME` / `LIRI_DATA_DIR`（与 `pdca-confirm.contract.test.ts` 同法）。
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import type http from 'http';

const isolateDir = mkdtempSync(join(tmpdir(), 'pdca-step-actions-'));
const prevLiriHome = process.env.LIRI_HOME;
const prevLiriDataDir = process.env.LIRI_DATA_DIR;
process.env.LIRI_HOME = isolateDir;
process.env.LIRI_DATA_DIR = isolateDir;

/**
 * 本文件创建的探针卡 id（`afterAll` 统一收口为 expired）。
 *
 * 2026-11-08（第三十六轮）：全量跑时若**别的用例先初始化**了 `inboxManager` 单例，其
 * dbPath 已固定为真实 data dir ⇒ 本文件的 `LIRI_DATA_DIR` 隔离失效，两张"撤销探针"卡
 * 会落进**用户真实收件箱**（实测全量跑后残留 2 条 pending）。按 id 收口可消除该污染。
 */
const createdInboxIds: string[] = [];

afterAll(async () => {
  try {
    if (createdInboxIds.length > 0) {
      await inboxManager.expireByIds(createdInboxIds);
    }
  } catch {
    // 清理失败不影响测试结论（临时目录仍会被删除）
  }
  if (prevLiriHome === undefined) delete process.env.LIRI_HOME;
  else process.env.LIRI_HOME = prevLiriHome;
  if (prevLiriDataDir === undefined) delete process.env.LIRI_DATA_DIR;
  else process.env.LIRI_DATA_DIR = prevLiriDataDir;
  try {
    rmSync(isolateDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch {
    // Windows 偶发 EBUSY：临时目录由系统清理
  }
});

const {
  handlePdcaReviewStep,
  handlePdcaDecideStep,
  handlePdcaAudit,
  closeOutStartFailure,
} = await import('../../src/infrastructure/http/handlers/pdca-handlers');
const { handleUndoApproval } =
  await import('../../src/infrastructure/http/handlers/inbox-handlers');
const { persistAuditReportFile } =
  await import('../../src/tasks/lro/reporting');
const { getOrCreateOrchestrator } =
  await import('../../src/tasks/LongRunningTaskOrchestrator');
const { taskOrchestrator } = await import('../../src/tasks/TaskOrchestrator');
const { inboxManager } = await import('@openliri/service/runtime/InboxManager');

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

function makeReq(body?: unknown): http.IncomingMessage {
  return makeRawReq(body === undefined ? '' : JSON.stringify(body));
}

function makeRawReq(raw: string): http.IncomingMessage {
  const req = new Readable({ read() {} }) as unknown as http.IncomingMessage & {
    headers: Record<string, string>;
  };
  req.headers = { host: 'localhost' };
  if (raw) req.push(raw);
  req.push(null);
  return req;
}

async function decide(taskId: string, body?: unknown) {
  const created = createRes();
  await handlePdcaDecideStep(makeReq(body), created.res, taskId, 'step_1');
  return created.read();
}

async function review(taskId: string) {
  const created = createRes();
  await handlePdcaReviewStep(makeReq(), created.res, taskId, 'step_1');
  return created.read();
}

async function audit(taskId: string) {
  const created = createRes();
  await handlePdcaAudit(makeReq(), created.res, taskId);
  return created.read();
}

describe('POST /v1/pdca/:taskId/step/:stepId/decide 契约', () => {
  test('非法 decision ⇒ 400（不再把 bogus 写进计划）', async () => {
    const { status, body } = await decide('pdca_decide_probe', {
      decision: 'bogus',
    });
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('invalid_decision');
    expect(body.decision).toBe('bogus');
    expect(Array.isArray(body.allowed)).toBe(true);
  });

  test('缺失 decision ⇒ 400', async () => {
    const { status, body } = await decide('pdca_decide_probe', {});
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_decision');
  });

  test('请求体不是合法 JSON ⇒ 400（而非 500）', async () => {
    const created = createRes();
    await handlePdcaDecideStep(
      makeRawReq('not-json'),
      created.res,
      'pdca_decide_probe',
      'step_1'
    );
    const { status, body } = created.read();
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_decision');
  });

  test('合法 decision 但任务未装载 ⇒ 404 not_found（原为 200 假成功）', async () => {
    const { status, body } = await decide('pdca_decide_missing_xyz', {
      decision: 'approved',
    });
    expect(status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('not_found');
    expect(body.taskId).toBe('pdca_decide_missing_xyz');
  });
});

describe('POST /v1/pdca/:taskId/step/:stepId/review 契约', () => {
  test('任务未装载 ⇒ 404 not_found（原为 200 {error:Not available}）', async () => {
    const { status, body } = await review('pdca_review_missing_xyz');
    expect(status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('not_found');
  });
});

function makeReqWithUrl(url: string): http.IncomingMessage {
  const req = makeRawReq('');
  (req as unknown as { url: string }).url = url;
  return req;
}

/**
 * 终态任务的步骤审查 / 决策准入（2026-11-08 真机 `pdca_mw7g2qiv`）。
 *
 * 修复前实测：对 `phase=completed` 的任务调 `review` 会**真的重跑一次 Reviewer**（模型调用、
 * 覆盖历史审查分 95→92）；调 `decide=retry` 会把已完成步骤改成 `pending`（`phase=completed`
 * / `plan.status=completed` / `step.status=pending` 自相矛盾）；不存在的 stepId 回 500。
 */
describe('终态任务的步骤审查 / 决策准入', () => {
  function seedPlan(taskId: string, phase: string) {
    const orchestrator = getOrCreateOrchestrator(taskId) as unknown as {
      planId: string;
      phase: string;
    };
    const plan = taskOrchestrator.createPlan(
      `契约探针 ${taskId}`,
      ['步骤1'],
      `session-${taskId}`
    );
    orchestrator.planId = plan.id;
    orchestrator.phase = phase;
    return plan;
  }

  test('completed 任务的 review ⇒ 409 task_terminal（不再真的重跑 Reviewer）', async () => {
    const taskId = 'pdca_terminal_review_probe';
    const plan = seedPlan(taskId, 'completed');
    const created = createRes();
    await handlePdcaReviewStep(
      makeReq(),
      created.res,
      taskId,
      plan.steps[0]!.id
    );
    const { status, body } = created.read();
    expect(status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('task_terminal');
    expect(body.phase).toBe('completed');
  });

  test('completed 任务的 decide=retry ⇒ 409，步骤状态不被改回 pending', async () => {
    const taskId = 'pdca_terminal_decide_probe';
    const plan = seedPlan(taskId, 'completed');
    const step = plan.steps[0]!;
    step.status = 'completed';
    const created = createRes();
    await handlePdcaDecideStep(
      makeReq({ decision: 'retry' }),
      created.res,
      taskId,
      step.id
    );
    const { status, body } = created.read();
    expect(status).toBe(409);
    expect(body.error).toBe('task_terminal');
    expect(step.status).toBe('completed');
    expect(step.retryCount).toBe(0);
  });

  test('stepId 不存在 ⇒ 404 step_not_found（原为 500 Step not found）', async () => {
    const taskId = 'pdca_missing_step_probe';
    seedPlan(taskId, 'execute');
    const created = createRes();
    await handlePdcaReviewStep(
      makeReq(),
      created.res,
      taskId,
      'step_does_not_exist'
    );
    const { status, body } = created.read();
    expect(status).toBe(404);
    expect(body.error).toBe('step_not_found');
  });
});

/**
 * `POST /v1/inbox/:id/undo` 契约（2026-11-08 真机 `pdca_mw7g2qiv`）。
 *
 * 修复前：步骤级 PDCA 卡（`source='permission'` + `metadata.pdcaTaskId`）撤销时既不中止
 * 任务，又把卡重置为 pending —— 接口回 `success:true`，但批准的命令照常执行完（假成功）。
 */
describe('POST /v1/inbox/:id/undo 契约', () => {
  async function submitReplied(
    metadata: Record<string, unknown>,
    source: string
  ): Promise<string> {
    const item = await inboxManager.submit({
      sessionId: `s-undo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'approval',
      title: '撤销探针',
      message: '撤销探针',
      options: ['approve', 'deny'],
      offlineCapable: true,
      source,
      metadata,
    });
    const replied = await inboxManager.reply(item.id, 'approve');
    expect(replied?.status).toBe('replied');
    createdInboxIds.push(item.id);
    return item.id;
  }

  test('PDCA 任务已不在内存 ⇒ success:false / task_finished，卡保持 replied', async () => {
    const id = await submitReplied(
      { pdcaTaskId: 'pdca_undo_not_live' },
      'permission'
    );
    const created = createRes();
    await handleUndoApproval(
      makeReqWithUrl(`/v1/inbox/${id}/undo`),
      created.res,
      {} as never
    );
    const { status, body } = created.read();
    expect(status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.reason).toBe('task_finished');
    expect(body.taskId).toBe('pdca_undo_not_live');
    const after = await inboxManager.get(id);
    expect(after?.status).toBe('replied');
  });

  test('非 PDCA 卡 ⇒ 保持原语义：成功并重置为 pending', async () => {
    const id = await submitReplied({}, 'system');
    const created = createRes();
    await handleUndoApproval(
      makeReqWithUrl(`/v1/inbox/${id}/undo`),
      created.res,
      {} as never
    );
    const { status, body } = created.read();
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    const after = await inboxManager.get(id);
    expect(after?.status).toBe('pending');
  });
});

/**
 * 启动期失败收口（2026-11-08 真机 `pdca_mw7gf70g`）。
 *
 * 修复前：规划阶段 `PLAN_PARSE_FAILED` 上抛后检查点停在 `status=started / phase=plan`
 * ⇒ 同会话再 start 恒返回旧 taskId（`existing:true`，新描述被丢弃）。
 */
describe('启动期失败收口 closeOutStartFailure', () => {
  /** 与 `tasks/phases.ts` 同源的终态集（service 层经端口注入，测试直接给定） */
  const TERMINAL_PHASES = new Set(['completed', 'failed', 'abort']);

  test('phase=plan ⇒ 落 failed 检查点并摘除死实例（解锁会话幂等键）', async () => {
    const patches: Array<Record<string, unknown>> = [];
    let disposed = false;
    const changed = await closeOutStartFailure(
      'pdca_start_fail_probe',
      {
        getStatus: () => ({ phase: 'plan' }),
        dispose: () => {
          disposed = true;
        },
      },
      async (id, patch) => {
        patches.push({ id, ...patch });
      },
      TERMINAL_PHASES
    );
    expect(changed).toBe(true);
    expect(disposed).toBe(true);
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({
      id: 'pdca_start_fail_probe',
      taskId: 'pdca_start_fail_probe',
      phase: 'failed',
      status: 'failed',
      replanPending: false,
    });
  });

  test('已终态（含用户中止）⇒ 不覆盖检查点、不摘实例', async () => {
    for (const phase of ['abort', 'failed', 'completed']) {
      let writes = 0;
      let disposed = false;
      const changed = await closeOutStartFailure(
        `pdca_start_fail_${phase}`,
        {
          getStatus: () => ({ phase }),
          dispose: () => {
            disposed = true;
          },
        },
        async () => {
          writes++;
        },
        TERMINAL_PHASES
      );
      expect(changed).toBe(false);
      expect(writes).toBe(0);
      expect(disposed).toBe(false);
    }
  });
});

describe('GET /v1/pdca/:taskId/audit 契约（重启后恢复）', () => {
  const persistedTaskId = 'pdca_audit_persisted';

  test('落盘报告存在（编排器未装载）⇒ 200 返回真实报告', async () => {
    persistAuditReportFile({
      taskId: persistedTaskId,
      planId: 'plan_audit_1',
      totalSteps: 1,
      completedSteps: 1,
      failedSteps: 0,
      skippedSteps: 0,
      totalDurationMs: 12,
      totalRetries: 0,
      steps: [],
      summary: '审计报告（落盘恢复）',
      generatedAt: 1,
    });

    const { status, body } = await audit(persistedTaskId);
    expect(status).toBe(200);
    expect(body.taskId).toBe(persistedTaskId);
    expect(body.summary).toBe('审计报告（落盘恢复）');
  });

  test('既无编排器也无落盘报告 ⇒ 404 not_found', async () => {
    const { status, body } = await audit('pdca_audit_missing_xyz');
    expect(status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('not_found');
  });
});
