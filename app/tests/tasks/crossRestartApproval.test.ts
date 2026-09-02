// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * L3（2026-09-01）：跨重启审批续跑 e2e
 *
 * 验证：PDCA 审批挂起（plan_pending）→ 进程重启 → 审批通过 → 续跑执行。
 * checkpoint 为文件持久化（~/.pyapp/data/pdca/<taskId>.json），
 * "写入 checkpoint → 新 orchestrator 实例（无内存状态）" 即等价于跨进程重启。
 *
 * 修复前：重启后新实例 phase='plan'（默认），resumeAfterApproval 抛 PDCA_NOT_PENDING，
 * 审批恢复必然失败（inbox 审批入口吞错降级）。
 * 修复后：resumeAfterApproval 检测到 checkpoint.phase==='plan_pending' 时
 * 先经 resumeFromCheckpoint 恢复，再继续 EXECUTE → REVIEW → DECIDE 循环。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getOrCreateOrchestrator,
  LongRunningTaskOrchestrator,
} from '../../src/tasks/LongRunningTaskOrchestrator';
import { NoopReviewGate } from '../../src/tasks/review/ReviewGate';
import { taskOrchestrator } from '../../src/tasks/TaskOrchestrator';
import {
  writePdcaCheckpoint,
  readPdcaCheckpoint,
} from '../../src/tasks/PdcaWorkItemBridge';
import { resolveDataSubDir } from '@modules/core';

// 隔离计划持久化目录：避免污染用户数据（~/.pyapp/data/plans/）
taskOrchestrator.setPlansDir(mkdtempSync(join(tmpdir(), 'plans-l3-restart-')));

const taskId = `l3-cross-restart-${Date.now()}`;
const sessionId = `session-${taskId}`;

// 访问私有成员（setTAORLoopFactory），与 batchParallel 测试同模式
type OrchestratorWithPrivates = LongRunningTaskOrchestrator & {
  setTAORLoopFactory: (f: (sessionId: string) => never) => void;
};

describe('L3 跨重启审批续跑（T2.1）', () => {
  afterAll(() => {
    // 清理 checkpoint 残留（独立 taskId，避免污染真实 pdca 数据）
    const ckPath = join(resolveDataSubDir('pdca'), `${taskId}.json`);
    rmSync(ckPath, { force: true });
  });

  it('模拟进程 A：审批挂起时 checkpoint 落盘 plan_pending + 步骤快照', () => {
    writePdcaCheckpoint(taskId, {
      taskId,
      sessionId,
      phase: 'plan_pending',
      description: 'L3 跨重启审批续跑任务',
      steps: [
        {
          id: 's1',
          description: '步骤1（已完成）',
          status: 'completed',
          result: 'ok',
        },
        {
          id: 's2',
          description: '步骤2（待执行）',
          status: 'pending',
        },
      ],
      lastEscalations: [],
    });

    const ck = readPdcaCheckpoint(taskId);
    expect(ck?.phase).toBe('plan_pending');
    expect((ck?.steps as Array<{ id: string }>)?.map((s) => s.id)).toEqual([
      's1',
      's2',
    ]);
  });

  it('模拟进程 B：重启后新实例审批通过 → 从 checkpoint 恢复并续跑执行', async () => {
    // 重启后新实例：无内存状态（phase 默认 'plan'），等价跨进程
    const orchestrator = getOrCreateOrchestrator(taskId) as unknown as OrchestratorWithPrivates;
    const executed: string[] = [];

    // 注入假 TAORLoop（避免真实 LLM 调用）+ NoopReviewGate（审查直接批准，不触 LLM）
    orchestrator.setTAORLoopFactory(() =>
      ({
        config: { sessionId: '' },
        runCollect: async () => {
          executed.push('run');
          return { turnCount: 1, totalTokens: 5 };
        },
      }) as never
    );
    orchestrator.setReviewGate(new NoopReviewGate());

    // 修复前：抛 PDCA_NOT_PENDING；修复后：自动恢复并续跑
    const status = await orchestrator.resumeAfterApproval(sessionId);

    // 续跑发生：假 TAORLoop 被调用（步骤2 被执行）
    expect(executed.length).toBeGreaterThan(0);
    // phase 已离开 plan_pending
    expect(status.phase).not.toBe('plan_pending');
  });

  it('无 plan_pending checkpoint 时仍抛 PDCA_NOT_PENDING（回归保护）', async () => {
    const orphanId = `l3-no-pending-${Date.now()}`;
    const orchestrator = getOrCreateOrchestrator(
      orphanId
    ) as unknown as OrchestratorWithPrivates;
    orchestrator.setTAORLoopFactory(() =>
      ({
        config: { sessionId: '' },
        runCollect: async () => ({ turnCount: 1, totalTokens: 5 }),
      }) as never
    );

    await expect(
      orchestrator.resumeAfterApproval(`session-${orphanId}`)
    ).rejects.toThrow(/not in plan_pending/);
  });
});
