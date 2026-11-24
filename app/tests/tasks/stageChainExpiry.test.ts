// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 批次 5（2026-11-24）：审批卡过期 ⇒ **当场**收口阶段链父检查点。
 *
 * 真机 `session_mwq5ookl21aa28ea96`：审批卡过期时只 abort 了子阶段 LRO，
 * 父检查点仍停在 `stage_awaiting_approval`，直到 14:33 重启才被孤儿扫描收口，
 * 且归因被播报成"进程重启"。本用例钉住：
 *   ① 父链停在审批门 ⇒ 立刻写 `abort` + `abortedBy='approval_expired'`；
 *   ② 回执同批发出（内容含"审批卡已过期"与 `/goal resume stage` 续跑入口）；
 *   ③ 父链仍在 running / 非阶段子任务 / 已终态 ⇒ 一律不收口（不抢编排器的推进）。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readPdcaCheckpoint,
  writePdcaCheckpoint,
} from '../../src/tasks/PdcaWorkItemBridge';
import {
  closeOutStageChainAfterApprovalExpiry,
  resolveParentStageChainId,
} from '../../src/tasks/lro/stageChainExpiry';
import {
  setPdcaReceiptSink,
  type PdcaReceiptSink,
} from '../../src/tasks/lro/terminalReceipt';

const dataDir = mkdtempSync(join(tmpdir(), 'stage-chain-expiry-'));
process.env.LIRI_DATA_DIR = dataDir;

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

const captureReceipts = (): Array<{ taskId: string; text: string }> => {
  const receipts: Array<{ taskId: string; text: string }> = [];
  const sink: PdcaReceiptSink = (p) => {
    receipts.push({ taskId: p.taskId, text: p.text });
  };
  setPdcaReceiptSink(sink);
  return receipts;
};

describe('阶段链审批过期当场收口（批次 5）', () => {
  it('子阶段 taskId → 父链 taskId（只按阶段后缀反解）', () => {
    expect(resolveParentStageChainId('pdca_abc_requirement')).toBe('pdca_abc');
    expect(resolveParentStageChainId('pdca_abc_design')).toBe('pdca_abc');
    expect(resolveParentStageChainId('pdca_abc')).toBeNull();
    expect(resolveParentStageChainId('pdca_abc_other')).toBeNull();
  });

  it('父链停在审批门 ⇒ 收口为 abort 并发回执（含续跑入口）', async () => {
    const receipts = captureReceipts();
    try {
      await writePdcaCheckpoint('pdca_expiry_1', {
        taskId: 'pdca_expiry_1',
        sessionId: 's-expiry-1',
        phase: 'stage_awaiting_approval',
        status: 'started',
        stages: [
          { id: 'requirement', status: 'awaiting_approval' },
          { id: 'design', status: 'pending' },
        ],
      });

      const parentId = await closeOutStageChainAfterApprovalExpiry(
        'pdca_expiry_1_requirement'
      );

      expect(parentId).toBe('pdca_expiry_1');
      const ck = await readPdcaCheckpoint('pdca_expiry_1');
      expect(ck?.phase).toBe('abort');
      expect(ck?.status).toBe('abort');
      expect(ck?.abortedBy).toBe('approval_expired');

      expect(receipts).toHaveLength(1);
      expect(receipts[0]?.text).toContain('审批卡已过期未处理');
      expect(receipts[0]?.text).not.toContain('进程重启');
      expect(receipts[0]?.text).toContain('0/2 阶段完成');
      expect(receipts[0]?.text).toContain('/goal resume stage pdca_expiry_1');
    } finally {
      setPdcaReceiptSink(undefined);
    }
  });

  it('父链仍在 running ⇒ 不收口（交给内存编排器推进）', async () => {
    const receipts = captureReceipts();
    try {
      await writePdcaCheckpoint('pdca_expiry_2', {
        taskId: 'pdca_expiry_2',
        sessionId: 's-expiry-2',
        phase: 'running',
        stages: [{ id: 'requirement', status: 'running' }],
      });

      const parentId = await closeOutStageChainAfterApprovalExpiry(
        'pdca_expiry_2_requirement'
      );

      expect(parentId).toBeNull();
      const ck = await readPdcaCheckpoint('pdca_expiry_2');
      expect(ck?.phase).toBe('running');
      expect(receipts).toHaveLength(0);
    } finally {
      setPdcaReceiptSink(undefined);
    }
  });

  it('入参是**父链 ID**（阶段审批卡携带的形态）⇒ 同样收口', async () => {
    const receipts = captureReceipts();
    try {
      await writePdcaCheckpoint('pdca_expiry_parent', {
        taskId: 'pdca_expiry_parent',
        sessionId: 's-expiry-parent',
        phase: 'stage_awaiting_approval',
        status: 'started',
        stages: [
          { id: 'requirement', status: 'awaiting_approval' },
          { id: 'design', status: 'pending' },
        ],
      });

      const parentId =
        await closeOutStageChainAfterApprovalExpiry('pdca_expiry_parent');

      expect(parentId).toBe('pdca_expiry_parent');
      const ck = await readPdcaCheckpoint('pdca_expiry_parent');
      expect(ck?.phase).toBe('abort');
      expect(ck?.abortedBy).toBe('approval_expired');
      expect(receipts).toHaveLength(1);
      expect(receipts[0]?.text).toContain('审批卡已过期未处理');
    } finally {
      setPdcaReceiptSink(undefined);
    }
  });

  it('非阶段子任务 / 已是终态 ⇒ 幂等跳过（不重复发回执）', async () => {
    const receipts = captureReceipts();
    try {
      expect(
        await closeOutStageChainAfterApprovalExpiry('pdca_no_stage')
      ).toBeNull();

      await writePdcaCheckpoint('pdca_expiry_3', {
        taskId: 'pdca_expiry_3',
        sessionId: 's-expiry-3',
        phase: 'abort',
        status: 'abort',
        abortedBy: 'orphan_scan',
        stages: [{ id: 'requirement', status: 'awaiting_approval' }],
      });
      expect(
        await closeOutStageChainAfterApprovalExpiry('pdca_expiry_3_requirement')
      ).toBeNull();

      expect(receipts).toHaveLength(0);
    } finally {
      setPdcaReceiptSink(undefined);
    }
  });
});
