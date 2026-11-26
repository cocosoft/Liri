// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P0（2026-11-24）：阶段审批卡的**落定语义**。
 *
 * 覆盖"拒绝"分支（批准分支要拉起真实子 PDCA，成本高且由 `stageOrchestrator` /
 * `/goal approve stage` 既有用例覆盖）：
 *   - 写 abort 终态，`abortedBy='user_abort'`（≠ 进程重启，不谎报）；
 *   - 回执照实播报已完成阶段数，并保留可续跑入口。
 */
import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readPdcaCheckpoint,
  writePdcaCheckpoint,
} from '../../src/tasks/PdcaWorkItemBridge';
import { settleStageApproval } from '../../src/tasks/lro/stageApproval';
import {
  resetStageOrchestratorFactory,
  setStageOrchestratorFactory,
} from '../../src/tasks/lro/stageOrchestratorPort';
import {
  setPdcaReceiptSink,
  type PdcaReceiptSink,
} from '../../src/tasks/lro/terminalReceipt';

const dataDir = mkdtempSync(join(tmpdir(), 'stage-approval-'));
process.env.LIRI_DATA_DIR = dataDir;

afterEach(() => {
  setPdcaReceiptSink(undefined);
  resetStageOrchestratorFactory();
});

afterAll(async () => {
  const { closePdcaCheckpointStore } =
    await import('../../src/tasks/PdcaWorkItemBridge');
  closePdcaCheckpointStore();
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    /* 临时目录清理失败不影响测试结论 */
  }
});

describe('settleStageApproval — 拒绝分支', () => {
  it('拒绝 ⇒ 阶段链 abort（user_abort）+ 回执（用户拒绝、保留产物）', async () => {
    const receipts: Array<{ taskId: string; text: string }> = [];
    const sink: PdcaReceiptSink = (p) =>
      receipts.push({ taskId: p.taskId, text: p.text });
    setPdcaReceiptSink(sink);

    await writePdcaCheckpoint('pdca_stage_reject_1', {
      taskId: 'pdca_stage_reject_1',
      sessionId: 's-reject-1',
      phase: 'stage_awaiting_approval',
      status: 'started',
      stages: [
        { id: 'requirement', status: 'awaiting_approval' },
        { id: 'design', status: 'pending' },
        { id: 'delivery', status: 'pending' },
      ],
    });

    await settleStageApproval({
      taskId: 'pdca_stage_reject_1',
      sessionId: 's-reject-1',
      approved: false,
    });

    const ck = await readPdcaCheckpoint('pdca_stage_reject_1');
    expect(ck?.phase).toBe('abort');
    expect(ck?.status).toBe('abort');
    expect(ck?.abortedBy).toBe('user_abort');

    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.text).toContain('用户拒绝');
    expect(receipts[0]?.text).not.toContain('进程重启');
    expect(receipts[0]?.text).toContain('3 阶段计划已保留');
    expect(receipts[0]?.text).toContain(
      '/goal resume stage pdca_stage_reject_1'
    );
  });

  it('目标不是阶段链（无 stages[]）⇒ 拒绝分支不改写任何检查点', async () => {
    await writePdcaCheckpoint('pdca_plain_task_1', {
      taskId: 'pdca_plain_task_1',
      sessionId: 's-plain-1',
      phase: 'execute',
      steps: [{ id: 'step_1', status: 'running' }],
    });

    await settleStageApproval({
      taskId: 'pdca_plain_task_1',
      sessionId: 's-plain-1',
      approved: false,
    });

    const ck = await readPdcaCheckpoint('pdca_plain_task_1');
    // 不是阶段链 ⇒ `fromCheckpoint` 返回 null ⇒ 直接返回（不误写 abort）
    expect(ck?.phase).toBe('execute');
  });
});

/**
 * 2026-11-27：批准分支改经 `stageOrchestratorPort`（断 `StageOrchestrator ↔ stageApproval`
 * 的 2 节点环，CI `check:circular` 基线为 0）。这里锁住端口的两种落定语义。
 */
describe('settleStageApproval — 批准分支经端口', () => {
  /** 前置判据要求 checkpoint 带 `stages[]`（否则按"非阶段链任务"直接返回） */
  const seedStageCheckpoint = async (taskId: string, sessionId: string) => {
    await writePdcaCheckpoint(taskId, {
      taskId,
      sessionId,
      phase: 'stage_awaiting_approval',
      status: 'started',
      stages: [
        { id: 'requirement', status: 'awaiting_approval' },
        { id: 'design', status: 'pending' },
      ],
    });
  };

  it('工厂已注册 ⇒ 续跑一次（taskId 透传）', async () => {
    const resumed: string[] = [];
    setStageOrchestratorFactory(async (taskId) => {
      return {
        resumeAfterApproval: async () => {
          resumed.push(taskId);
        },
      };
    });
    await seedStageCheckpoint('pdca_stage_approve_1', 's-approve-1');

    await settleStageApproval({
      taskId: 'pdca_stage_approve_1',
      sessionId: 's-approve-1',
      approved: true,
    });

    expect(resumed).toEqual(['pdca_stage_approve_1']);
  });

  it('工厂未注册 ⇒ 不抛异常（如实 warn，不谎报已续跑）', async () => {
    await seedStageCheckpoint('pdca_stage_approve_2', 's-approve-2');

    await expect(
      settleStageApproval({
        taskId: 'pdca_stage_approve_2',
        sessionId: 's-approve-2',
        approved: true,
      })
    ).resolves.toBeUndefined();
  });

  it('工厂返回 null（非阶段链任务）⇒ 不续跑、不抛异常', async () => {
    let called = false;
    setStageOrchestratorFactory(async () => {
      called = true;
      return null;
    });
    await seedStageCheckpoint('pdca_stage_approve_3', 's-approve-3');

    await settleStageApproval({
      taskId: 'pdca_stage_approve_3',
      sessionId: 's-approve-3',
      approved: true,
    });

    expect(called).toBe(true);
  });
});
