// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * PDCA 状态投影的**字段一致性**（2026-11-07 真机）。
 *
 * 现象：详情接口 `GET /v1/pdca/:id` 在「内存（重启前）」与「检查点（重启后）」两条
 * 路径返回的字段不同 —— 内存快照缺 `sessionId`/`description`（真机
 * `pdca_mw6e0e94`：`session=` 为空），而检查点读模型有。
 *
 * 现口径：内存投影也带 `sessionId`/`description`（取自计划，createPlan 时已落库）。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { taskOrchestrator } from '../../src/tasks/TaskOrchestrator';
import { projectPdcaStatus } from '../../src/tasks/lro/reporting';

// 隔离计划持久化目录，避免污染用户数据（~/.pyapp/data/plans/）
const plansDir = mkdtempSync(join(tmpdir(), 'plans-status-projection-'));
taskOrchestrator.setPlansDir(plansDir);

afterAll(() => {
  try {
    rmSync(plansDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch {
    // Windows 偶发 EBUSY：临时目录由系统清理
  }
});

describe('PDCA 状态投影字段（内存/检查点一致性）', () => {
  it('内存投影包含 sessionId 与 description（取自计划）', () => {
    const plan = taskOrchestrator.createPlan(
      '投影测试任务',
      ['步骤一'],
      'session-proj-1'
    );

    const status = projectPdcaStatus({
      taskId: 'task-proj-1',
      planId: plan.id,
      phase: 'execute',
      decisionAwait: null,
      auditReport: null,
      lifecycle: [],
      stepDurations: new Map(),
    });

    expect(status.sessionId).toBe('session-proj-1');
    expect(status.description).toBe('投影测试任务');
  });
});
