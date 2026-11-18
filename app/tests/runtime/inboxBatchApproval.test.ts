/**
 * P1-1（2026-11-06）：批量审批候选筛选契约。
 *
 * 背景（真机 `dev_docs/20261106/俄罗斯方块长程会话导出排查-20261106.md` §29 P1-1）：
 * 同一轮 3 个 `mkdir` 各生成一张审批卡，只能逐张点批准。
 * `selectBatchApprovalTargets` 负责"哪些卡能被一键批准"的判定 —— 这里钉住口径：
 * 只取 pending + approval（可选同工具名），顺序保持入参顺序，不扩大到提问/已处理项。
 */
import { describe, expect, it } from 'bun:test';
import { selectBatchApprovalTargets } from '@openliri/service/runtime/inboxApproval';

type Item = {
  id: string;
  status?: string;
  type?: string;
  metadata?: Record<string, unknown>;
};

const items: Item[] = [
  {
    id: 'a',
    status: 'pending',
    type: 'approval',
    metadata: { toolName: 'bash' },
  },
  {
    id: 'b',
    status: 'replied',
    type: 'approval',
    metadata: { toolName: 'bash' },
  },
  {
    id: 'c',
    status: 'pending',
    type: 'question',
    metadata: { toolName: 'bash' },
  },
  {
    id: 'd',
    status: 'pending',
    type: 'approval',
    metadata: { toolName: 'file_write' },
  },
  {
    id: 'e',
    status: 'expired',
    type: 'approval',
    metadata: { toolName: 'bash' },
  },
];

describe('selectBatchApprovalTargets（P1-1 批量审批）', () => {
  it('只取 pending + approval，且保持入参顺序', () => {
    expect(selectBatchApprovalTargets(items).map((i) => i.id)).toEqual([
      'a',
      'd',
    ]);
  });

  it('给定 toolName 时只批同一工具', () => {
    expect(selectBatchApprovalTargets(items, 'bash').map((i) => i.id)).toEqual([
      'a',
    ]);
    expect(
      selectBatchApprovalTargets(items, 'file_write').map((i) => i.id)
    ).toEqual(['d']);
  });

  it('空列表 / 无匹配 ⇒ 空数组（不抛错）', () => {
    expect(selectBatchApprovalTargets([])).toEqual([]);
    expect(selectBatchApprovalTargets(items, 'unknown_tool')).toEqual([]);
  });

  // B8（2026-11-18）：前端「逐条勾选」—— 只落地选中项，未选中的卡保持 pending
  it('给定 ids 时只取选中项（空数组 ⇒ 退回「全部待批」口径）', () => {
    expect(
      selectBatchApprovalTargets(items, undefined, ['d']).map((i) => i.id)
    ).toEqual(['d']);
    // 选中集合里混入非 pending / 其它类型 ⇒ 仍被基础口径过滤掉
    expect(
      selectBatchApprovalTargets(items, undefined, ['a', 'b', 'c']).map(
        (i) => i.id
      )
    ).toEqual(['a']);
    // 空数组视为"未指定"，不是"一个都不批"
    expect(
      selectBatchApprovalTargets(items, undefined, []).map((i) => i.id)
    ).toEqual(['a', 'd']);
  });
});
