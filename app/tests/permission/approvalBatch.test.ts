/**
 * 审批批量合并（P3，2026-11-17）—— 判定与合并簿单测。
 *
 * 口径：仅"同工具 + 同风险 + **同轮次**"可合并；工作区申请不合并；单卡上限 5；合并簿只存内存，
 * 批准时 drain 一次性取出（拒绝也 drain，但**不**写放行缓存）。
 */
import { beforeEach, describe, expect, it } from 'bun:test';

import {
  APPROVAL_BATCH_MAX,
  APPROVAL_BATCH_TTL_MS,
  addApprovalBatchEntry,
  canBatchApproval,
  clearApprovalBatches,
  drainApprovalBatch,
  getApprovalBatchSize,
} from '../../../packages/service/src/runtime/approvalBatch';

const base = {
  enabled: true,
  pendingCount: 0,
  candidateToolName: 'bash',
  candidateRisk: 'shell',
  candidateIsWorkspaceScope: false,
  // B8：同轮次限定 —— 两侧轮次标识必须存在且相等
  candidateRoundId: 7,
  toolName: 'bash',
  risk: 'shell',
  roundId: 7,
};

beforeEach(() => {
  clearApprovalBatches();
});

describe('canBatchApproval', () => {
  it('同工具 + 同风险 + 未达上限 ⇒ 允许合并', () => {
    expect(canBatchApproval(base)).toBe(true);
  });

  it('总闸关 / 工作区申请 / 不同工具 / 不同风险 / 已达上限 ⇒ 不合并', () => {
    expect(canBatchApproval({ ...base, enabled: false })).toBe(false);
    expect(canBatchApproval({ ...base, candidateIsWorkspaceScope: true })).toBe(
      false
    );
    expect(canBatchApproval({ ...base, candidateToolName: 'file_write' })).toBe(
      false
    );
    expect(canBatchApproval({ ...base, candidateRisk: 'write' })).toBe(false);
    expect(
      canBatchApproval({ ...base, pendingCount: APPROVAL_BATCH_MAX })
    ).toBe(false);
  });

  it('B8：卡片创建超过 TTL（120s）⇒ 不再合并；边界内仍可合并', () => {
    const now = 1_000_000;
    expect(
      canBatchApproval({
        ...base,
        candidateCreatedAt: now - APPROVAL_BATCH_TTL_MS,
        now,
      })
    ).toBe(true);
    expect(
      canBatchApproval({
        ...base,
        candidateCreatedAt: now - APPROVAL_BATCH_TTL_MS - 1,
        now,
      })
    ).toBe(false);
  });

  it('B8 同轮次限定：轮次不同 / 任一侧缺轮次 ⇒ 不合并', () => {
    // 上一轮遗留的卡（候选 roundId 7）遇到本轮 ask（roundId 8）⇒ 不合并
    expect(canBatchApproval({ ...base, candidateRoundId: 8 })).toBe(false);
    // 候选卡没有轮次（旧卡 / 未接入路径）⇒ 无法证明同轮 ⇒ 不合并
    expect(canBatchApproval({ ...base, candidateRoundId: undefined })).toBe(
      false
    );
    // 本条 ask 没有轮次 ⇒ 同上
    expect(canBatchApproval({ ...base, roundId: undefined })).toBe(false);
  });
});

describe('合并簿（add / size / drain / clear）', () => {
  it('累计到上限后拒绝继续追加；drain 取走并清空', () => {
    const id = 'inbox-1';
    for (let i = 0; i < APPROVAL_BATCH_MAX; i += 1) {
      expect(
        addApprovalBatchEntry(id, {
          commandHash: `hash-${i}`,
          command: `cmd ${i}`,
        })
      ).toBe(true);
    }
    expect(getApprovalBatchSize(id)).toBe(APPROVAL_BATCH_MAX);
    expect(addApprovalBatchEntry(id, { commandHash: 'overflow' })).toBe(false);
    expect(getApprovalBatchSize(id)).toBe(APPROVAL_BATCH_MAX);

    const drained = drainApprovalBatch(id);
    expect(drained.map((e) => e.commandHash)).toEqual(
      Array.from({ length: APPROVAL_BATCH_MAX }, (_, i) => `hash-${i}`)
    );
    expect(getApprovalBatchSize(id)).toBe(0);
    expect(drainApprovalBatch(id)).toEqual([]);
  });

  it('空 commandHash 不入簿；clear 清空全部', () => {
    expect(addApprovalBatchEntry('inbox-2', { commandHash: '' })).toBe(false);
    addApprovalBatchEntry('inbox-2', { commandHash: 'h' });
    addApprovalBatchEntry('inbox-3', { commandHash: 'h2' });
    clearApprovalBatches();
    expect(getApprovalBatchSize('inbox-2')).toBe(0);
    expect(getApprovalBatchSize('inbox-3')).toBe(0);
  });

  it('B8：合并窗口过期 ⇒ 重新起窗（不带旧条目）', () => {
    const id = 'inbox-ttl';
    addApprovalBatchEntry(id, { commandHash: 'old' }, 1_000);
    expect(getApprovalBatchSize(id)).toBe(1);
    // 刚过 TTL：旧条目作废，重新起窗
    addApprovalBatchEntry(
      id,
      { commandHash: 'new' },
      1_000 + APPROVAL_BATCH_TTL_MS + 1
    );
    expect(drainApprovalBatch(id).map((e) => e.commandHash)).toEqual(['new']);
  });
});
