// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * GET /v1/pdca/:taskId 契约测试（1-5 P2 跨重启详情适配，2026-09-04）
 * 验证：无内存 orchestrator 时，checkpoint 回退返回与 getStatus() 对齐的读模型——
 * plan/progress 由快照 steps 推导（原样透传含 reviewResult/dependsOn）；无 steps 不编造；
 * checkpoint 不存在保持原空态。隔离 LIRI_HOME（临时目录）。
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import type http from 'http';

process.env.LIRI_HOME = mkdtempSync(join(tmpdir(), 'pdca-status-http-'));

const { writePdcaCheckpoint } =
  await import('../../src/tasks/PdcaWorkItemBridge');
const { handlePdcaStatus } =
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
writePdcaCheckpoint('pdca_st_active', {
  taskId: 'pdca_st_active',
  planId: 'plan_st_active',
  phase: 'execute',
  status: 'running',
  description: '执行中的跨重启任务',
  sessionId: 'sess_st',
  workspaceId: 'ws_st',
  projectId: 'proj_st',
  workItemId: 'wi_st',
  steps: [
    makeStep('s1', '调研', 'completed'),
    makeStep('s2', '实现', 'running'),
  ],
});

// review 阶段，3 步（2 completed + 1 pending）→ percent 67
writePdcaCheckpoint('pdca_st_review', {
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
writePdcaCheckpoint('pdca_st_nosteps', {
  taskId: 'pdca_st_nosteps',
  planId: 'stage_parent',
  phase: 'plan_pending',
  status: 'started',
  description: '待审批的阶段链任务',
  sessionId: 'sess_st',
  workspaceId: 'ws_st',
  projectId: 'proj_st',
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
});
