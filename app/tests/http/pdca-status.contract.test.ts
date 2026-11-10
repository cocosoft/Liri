// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * GET /v1/pdca/:taskId 契约测试（1-5 P2 跨重启详情适配，2026-09-04）
 * 验证：无内存 orchestrator 时，checkpoint 回退返回与 getStatus() 对齐的读模型——
 * plan/progress 由快照 steps 推导（原样透传含 reviewResult/dependsOn）；无 steps 不编造；
 * checkpoint 不存在保持原空态。隔离 LIRI_HOME（临时目录）。
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import type http from 'http';

const isolateDir = mkdtempSync(join(tmpdir(), 'pdca-status-http-'));
// 2026-10-11 修正（跨文件 env 泄漏）：记录原值并在 `afterAll` 还原 —— 否则 `LIRI_HOME`/
// `LIRI_DATA_DIR` 会泄漏给同进程后续测试文件（`resolveDataDir` 中 `LIRI_DATA_DIR`
// **优先于** `setUserDataDirOverride`）。
const prevLiriHome = process.env.LIRI_HOME;
const prevLiriDataDir = process.env.LIRI_DATA_DIR;
process.env.LIRI_HOME = isolateDir;
// GAI-3：checkpoint 迁入 app.db ⇒ 同时隔离数据目录（LIRI_DATA_DIR 优先于 setUserDataDirOverride）
process.env.LIRI_DATA_DIR = isolateDir;

afterAll(() => {
  if (prevLiriHome === undefined) delete process.env.LIRI_HOME;
  else process.env.LIRI_HOME = prevLiriHome;
  if (prevLiriDataDir === undefined) delete process.env.LIRI_DATA_DIR;
  else process.env.LIRI_DATA_DIR = prevLiriDataDir;
});

const { writePdcaCheckpoint } =
  await import('../../src/tasks/PdcaWorkItemBridge');
const { handlePdcaStatus, withProgressIteration } =
  await import('../../src/infrastructure/http/handlers/pdca-handlers');

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

function makeReq(): http.IncomingMessage {
  const req = new Readable({ read() {} }) as unknown as http.IncomingMessage & {
    headers: Record<string, string>;
  };
  req.headers = { host: 'localhost' };
  req.push(null);
  return req;
}

async function call(taskId: string) {
  const created = createRes();
  await handlePdcaStatus(makeReq(), created.res, taskId);
  return {
    status: created.status,
    body: JSON.parse(created.body) as Record<string, unknown>,
  };
}

// ── 预写 checkpoint 快照（模拟跨重启遗留任务，无内存 orchestrator）──

interface CkStep {
  id: string;
  description: string;
  status: string;
  retryCount?: number;
  maxRetries?: number;
  reviewResult?: Record<string, unknown>;
  decision?: string;
  dependsOn?: string[];
}

function makeStep(id: string, description: string, status: string): CkStep {
  return {
    id,
    description,
    status,
    retryCount: 0,
    maxRetries: 2,
    ...(status === 'completed'
      ? {
          reviewResult: {
            stepId: id,
            pass: true,
            score: 9,
            issues: [],
            summary: '符合验收标准',
          },
          decision: 'approved',
        }
      : {}),
  };
}

// 活跃：execute 阶段，2 步（1 completed + 1 running）→ percent 50
await writePdcaCheckpoint('pdca_st_active', {
  taskId: 'pdca_st_active',
  planId: 'plan_st_active',
  phase: 'execute',
  status: 'running',
  description: '执行中的跨重启任务',
  sessionId: 'sess_st',
  workspaceId: 'ws_st',
  projectId: 'proj_st',
  workItemId: 'wi_st',
  // §60.4①（2026-11-10）：多轮任务的检查点带 `loopIteration`（真实库 `pdca_mw8nknox` = 4）
  loopIteration: 3,
  steps: [
    makeStep('s1', '调研', 'completed'),
    makeStep('s2', '实现', 'running'),
  ],
});

// review 阶段，3 步（2 completed + 1 pending）→ percent 67
await writePdcaCheckpoint('pdca_st_review', {
  taskId: 'pdca_st_review',
  planId: 'plan_st_review',
  phase: 'review',
  status: 'running',
  description: '审查中的跨重启任务',
  sessionId: 'sess_st',
  workspaceId: 'ws_st',
  projectId: 'proj_st',
  steps: [
    makeStep('s1', '调研', 'completed'),
    makeStep('s2', '实现', 'completed'),
    makeStep('s3', '验证', 'pending'),
  ],
});

// 无 steps 快照（阶段链父任务等）：不编造 plan/progress
await writePdcaCheckpoint('pdca_st_nosteps', {
  taskId: 'pdca_st_nosteps',
  planId: 'stage_parent',
  phase: 'plan_pending',
  status: 'started',
  description: '待审批的阶段链任务',
  sessionId: 'sess_st',
  workspaceId: 'ws_st',
  projectId: 'proj_st',
});

// 2026-11-07（真机 pdca_mw6bpgs5）：跨重启后的 Inbox 审批路径会创建**空编排器**
// （无 plan/planId，phase 默认 'plan'）⇒ 状态接口必须仍按检查点读模型返回。
await writePdcaCheckpoint('pdca_st_bare_orch', {
  taskId: 'pdca_st_bare_orch',
  planId: 'plan_st_bare',
  phase: 'stage_awaiting_approval',
  status: 'running',
  description: '等待步骤审批的跨重启任务',
  sessionId: 'sess_st',
  steps: [
    makeStep('s1', '执行', 'completed'),
    makeStep('s2', '待执行', 'pending'),
  ],
});

// 2026-11-08（真机）：跨重启读模型同样要认「成功工具证据」——只读完成步（空台账）
// 不能被产物门永久压住，否则 3/3 完成的任务重启后仍显示 67%。
await writePdcaCheckpoint('pdca_st_evidence', {
  taskId: 'pdca_st_evidence',
  planId: 'plan_st_evidence',
  phase: 'completed',
  status: 'completed',
  description: '含只读校验步的已完成任务',
  sessionId: 'sess_st',
  steps: [
    { ...makeStep('s1', '写文件', 'completed'), artifacts: ['out/a.txt'] },
    {
      ...makeStep('s2', '读回确认', 'completed'),
      artifacts: [],
      toolOutcomes: {
        outcomes: [],
        total: 1,
        successCount: 1,
        failedCount: 0,
        securityIntercepted: 0,
        pendingApproval: 0,
      },
    },
  ],
});

describe('GET /v1/pdca/:taskId 契约（1-5 P2 跨重启详情适配）', () => {
  test('活跃 checkpoint：构造 plan{steps} 原样透传 + progress 推导（1c1r → 50%）', async () => {
    const { status, body } = await call('pdca_st_active');
    expect(status).toBe(200);
    expect(body.source).toBe('checkpoint');
    expect(body.taskId).toBe('pdca_st_active');
    expect(body.phase).toBe('execute');
    expect(body.status).toBe('running');
    expect(body.planId).toBe('plan_st_active');
    const plan = body.plan as { id: string; steps: CkStep[] };
    expect(plan.id).toBe('plan_st_active');
    expect(plan.steps.length).toBe(2);
    expect(plan.steps[0].status).toBe('completed');
    expect(plan.steps[0].decision).toBe('approved');
    const progress = body.progress as Record<string, number>;
    expect(progress.completed).toBe(1);
    expect(progress.running).toBe(1);
    expect(progress.pending).toBe(0);
    expect(progress.percent).toBe(50);
    // §60.4①（2026-11-10 真机核查）：轮次同时给顶层与 progress（内存/检查点字段对齐）
    expect(body.loopIteration).toBe(3);
    expect(progress.iteration).toBe(3);
  });

  test('review 阶段部分完成：progress 推导（2c1p → 67%）', async () => {
    const { status, body } = await call('pdca_st_review');
    expect(status).toBe(200);
    expect(body.phase).toBe('review');
    const progress = body.progress as Record<string, number>;
    expect(progress.total).toBe(3);
    expect(progress.completed).toBe(2);
    expect(progress.pending).toBe(1);
    expect(progress.percent).toBe(67);
    // 旧检查点没有 loopIteration ⇒ 不编造轮次（CS06）
    expect(progress.iteration).toBeUndefined();
  });

  test('空台账但有成功工具证据 ⇒ 进度 100%、不被产物门压住', async () => {
    const { status, body } = await call('pdca_st_evidence');
    expect(status).toBe(200);
    const progress = body.progress as Record<string, unknown>;
    expect(progress.completed).toBe(2);
    expect(progress.total).toBe(2);
    expect(progress.percent).toBe(100);
    expect(progress.artifactGated).toBe(false);
  });

  test('无 steps checkpoint：省略 plan/progress，不编造', async () => {
    const { status, body } = await call('pdca_st_nosteps');
    expect(status).toBe(200);
    expect(body.phase).toBe('plan_pending');
    expect(body.status).toBe('started');
    expect(body.plan).toBeUndefined();
    expect(body.progress).toBeUndefined();
    expect(body.source).toBe('checkpoint');
  });

  test('checkpoint 不存在：保持原空态 {phase:none}', async () => {
    const { status, body } = await call('pdca_missing_xyz');
    expect(status).toBe(200);
    expect(body.phase).toBe('none');
    expect(body.taskId).toBe('pdca_missing_xyz');
  });

  // 2026-11-07（真机）：Inbox 审批路径先建了一个**空编排器**，此前状态接口就不再回退
  // 检查点 ⇒ 阶段从 stage_awaiting_approval 退化为 plan、步骤清单消失。
  test('内存空编排器（无 plan）⇒ 仍按检查点读模型返回（阶段/步骤不丢失）', async () => {
    const { getCoreAPI } = await import('../../src/runtime/api/CoreAPIImpl');
    const port = await getCoreAPI().getTaskOpsPort();
    const orchestrator = (await port.getOrCreatePdcaOrchestrator(
      'pdca_st_bare_orch'
    )) as unknown as { dispose?: () => void };
    try {
      const { status, body } = await call('pdca_st_bare_orch');
      expect(status).toBe(200);
      expect(body.source).toBe('checkpoint');
      expect(body.phase).toBe('stage_awaiting_approval');
      expect(body.planId).toBe('plan_st_bare');
      const plan = body.plan as { steps: CkStep[] };
      expect(plan.steps.map((s) => s.id)).toEqual(['s1', 's2']);
    } finally {
      orchestrator?.dispose?.();
    }
  });
});

/**
 * §60.4①（2026-11-10）：内存路径的「第 N 轮」合并。
 *
 * 历史缺口（真机 `pdca_mw7r380j`）：`getStatus()` 早期没有 `loopIteration` ⇒ 详情接口
 * `iter=` 为空，只有检查点回退路径能显示轮次。现口径：内存投影给顶层 `loopIteration`，
 * 本函数把它并入 `progress.iteration`；`0`（尚未进入执行循环）不显示。
 */
describe('withProgressIteration（内存路径轮次合并）', () => {
  test('loopIteration>0 ⇒ 并入 progress.iteration，其他字段原样', () => {
    const out = withProgressIteration({
      loopIteration: 3,
      replanPending: false,
      progress: { completed: 1, total: 2, percent: 50 },
    });
    expect(out.progress).toEqual({
      completed: 1,
      total: 2,
      percent: 50,
      iteration: 3,
    });
    expect(out.loopIteration).toBe(3);
    expect(out.replanPending).toBe(false);
  });

  test('loopIteration=0（plan 阶段）⇒ 原样返回（不显示"第 0 轮"）', () => {
    const input = { loopIteration: 0, progress: { completed: 0, total: 0 } };
    expect(withProgressIteration(input)).toBe(input);
  });

  test('无 loopIteration / 无 progress ⇒ 原样返回（不造字段）', () => {
    const noIter = { progress: { completed: 1, total: 2 } };
    expect(withProgressIteration(noIter)).toBe(noIter);
    const noProgress = { loopIteration: 2 };
    expect(withProgressIteration(noProgress)).toBe(noProgress);
  });
});
