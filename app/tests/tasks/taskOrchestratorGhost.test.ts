// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * U-02（2026-10-17）：TaskOrchestrator 恢复加载的 ghost 判定守卫。
 *
 * 锁定的不变量：
 * 1. `pending`（尚未开跑）不得在加载期被 abort；
 * 2. `running` + 无活跃步骤 + 心跳新鲜 ⇒ 不 abort；
 * 3. `running` + 无活跃步骤 + 心跳过期/缺失且 createdAt 过期 ⇒ abort；
 * 4. createPlan 在加载完成后创建，不覆盖已加载计划。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  TaskOrchestrator,
  type Plan,
} from '../../src/tasks/TaskOrchestrator.js';

function makePlan(overrides: Partial<Plan> = {}): Plan {
  const now = new Date().toISOString();
  return {
    id: 'p1',
    description: '测试计划',
    steps: [
      {
        id: 's1',
        description: '步骤1',
        status: 'pending',
        taskId: 't1',
        retryCount: 0,
        maxRetries: 3,
      },
    ],
    status: 'pending',
    createdAt: now,
    sessionId: 'sess-1',
    ...overrides,
  };
}

describe('TaskOrchestrator ghost plan 恢复判定', () => {
  let dir: string;
  let orchestrator: TaskOrchestrator;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pyapp-plans-'));
    orchestrator = new TaskOrchestrator();
    orchestrator.setPlansDir(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writePlan(plan: Plan, fileName = `plan_${plan.id}.json`): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, fileName), JSON.stringify(plan, null, 2), 'utf-8');
  }

  it('pending 计划不会被加载期 abort', async () => {
    writePlan(makePlan({ status: 'pending' }));
    await orchestrator.initialize();
    expect(orchestrator.getPlan('p1')?.status).toBe('pending');
  });

  it('running + 心跳新鲜 ⇒ 保持 running', async () => {
    writePlan(
      makePlan({
        status: 'running',
        lastHeartbeatAt: new Date().toISOString(),
      })
    );
    await orchestrator.initialize();
    expect(orchestrator.getPlan('p1')?.status).toBe('running');
  });

  it('running + 心跳过期 ⇒ abort', async () => {
    writePlan(
      makePlan({
        status: 'running',
        lastHeartbeatAt: new Date(Date.now() - 11 * 60_000).toISOString(),
      })
    );
    await orchestrator.initialize();
    expect(orchestrator.getPlan('p1')?.status).toBe('aborted');
  });

  it('旧数据无心跳但 createdAt 过期 ⇒ abort', async () => {
    writePlan(
      makePlan({
        status: 'running',
        createdAt: new Date(Date.now() - 11 * 60_000).toISOString(),
      })
    );
    await orchestrator.initialize();
    expect(orchestrator.getPlan('p1')?.status).toBe('aborted');
  });

  it('createPlan 在加载后创建，不覆盖已加载计划', async () => {
    writePlan(makePlan({ id: 'old', status: 'pending' }));
    await orchestrator.initialize();
    const created = orchestrator.createPlan('新任务', ['步骤A'], 'sess-2');
    expect(orchestrator.getPlan('old')?.id).toBe('old');
    expect(orchestrator.getPlan(created.id)?.id).toBe(created.id);
  });
});
