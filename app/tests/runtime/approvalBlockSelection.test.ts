// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// P3-1（2026-11-06）回归锁：已处理/已过期审批块在**同一回合窗口内**仍要合成。
//
// 真机 `session_mw458fpp3ea32a050e`：卡片一旦被批准/过期，读消息时整块消失，
// 而助手消息里"请在审批卡中批准"的文字还在 ⇒ 用户「没看到命令审批卡」。

import { describe, expect, it } from 'bun:test';
import {
  APPROVAL_BLOCK_LOOKBACK_MS,
  APPROVAL_BLOCK_MAX_RESOLVED,
  selectApprovalItemsForBlocks,
} from '@openliri/service/runtime/api/approvalBlockSelection';

type Item = { id: string; status: string; createdAt: number };
const NOW = 1_000_000_000_000;

function item(id: string, status: string, ageMs: number): Item {
  return { id, status, createdAt: NOW - ageMs };
}

describe('selectApprovalItemsForBlocks', () => {
  it('pending 全量 + 窗口内 replied/expired；窗口外与其它状态剔除', () => {
    const pending = [item('p1', 'pending', 60_000)];
    const recent = [
      item('r1', 'replied', 120_000),
      item('e1', 'expired', 180_000),
      item('old', 'expired', APPROVAL_BLOCK_LOOKBACK_MS + 1),
      item('proc', 'processing', 30_000),
      item('dis', 'dismissed', 30_000),
      item('p1', 'pending', 60_000),
    ];

    const selected = selectApprovalItemsForBlocks({
      pending,
      recent,
      anchorMs: NOW,
    });

    expect(selected.map((i) => i.id)).toEqual(['e1', 'r1', 'p1']);
  });

  it('按创建时间升序（与创建顺序一致）', () => {
    const selected = selectApprovalItemsForBlocks({
      pending: [item('b', 'pending', 1000)],
      recent: [item('a', 'replied', 3000), item('c', 'expired', 2000)],
      anchorMs: NOW,
    });
    expect(selected.map((i) => i.id)).toEqual(['a', 'c', 'b']);
  });

  it('已处理项数量封顶（防历史噪声）', () => {
    const recent = Array.from(
      { length: APPROVAL_BLOCK_MAX_RESOLVED + 5 },
      (_, i) => item(`r${i}`, 'replied', 1000 + i)
    );
    const selected = selectApprovalItemsForBlocks({
      pending: [],
      recent,
      anchorMs: NOW,
    });
    expect(selected).toHaveLength(APPROVAL_BLOCK_MAX_RESOLVED);
  });

  it('空输入 ⇒ 空数组（不凭空造卡）', () => {
    expect(
      selectApprovalItemsForBlocks({ pending: [], recent: [], anchorMs: NOW })
    ).toEqual([]);
  });
});
