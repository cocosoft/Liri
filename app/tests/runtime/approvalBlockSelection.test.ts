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
  refreshPresentApprovalBlocks,
  resolveApprovalHostIndex,
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

describe('resolveApprovalHostIndex（2026-11-12：审批卡归位到发生的那一轮）', () => {
  const msgs = [
    { role: 'user', timestamp: 900 },
    { role: 'assistant', timestamp: 1000 },
    { role: 'user', timestamp: 4000 },
    { role: 'assistant', timestamp: 5000 },
  ];

  it('创建时刻落在两轮之间 ⇒ 归到之前最近的那条 assistant', () => {
    expect(resolveApprovalHostIndex(msgs, { createdAt: 3000 })).toBe(1);
  });

  it('创建时刻晚于最后一条 assistant ⇒ 归到最后一条', () => {
    expect(resolveApprovalHostIndex(msgs, { createdAt: 9000 })).toBe(3);
  });

  it('创建时刻早于全部 assistant（时钟偏差/老会话）⇒ 回退第一条 assistant', () => {
    expect(resolveApprovalHostIndex(msgs, { createdAt: 1 })).toBe(1);
  });

  it('无 assistant 消息 ⇒ -1（调用方回退 lastAssistant）', () => {
    expect(
      resolveApprovalHostIndex([{ role: 'user', timestamp: 1 }], {
        createdAt: 2,
      })
    ).toBe(-1);
  });

  it('toolCallId 命中 ⇒ 精确归位（优先于时间锚点）', () => {
    const withCalls = [
      {
        role: 'assistant',
        timestamp: 1000,
        blocks: [{ type: 'tool_call', toolCall: { id: 'call-a' } }],
      },
      {
        role: 'assistant',
        timestamp: 5000,
        blocks: [{ type: 'tool_call', toolCallId: 'call-b' }],
      },
    ];
    // 时间锚点本会选第 2 条（6000 晚于 5000），toolCallId 命中第 1 条
    expect(
      resolveApprovalHostIndex(withCalls, {
        createdAt: 6000,
        toolCallId: 'call-a',
      })
    ).toBe(0);
    expect(
      resolveApprovalHostIndex(withCalls, {
        createdAt: 1,
        toolCallId: 'call-b',
      })
    ).toBe(1);
  });

  it('toolCallId 未命中任何消息 ⇒ 回退时间锚点（不丢卡）', () => {
    expect(
      resolveApprovalHostIndex(msgs, { createdAt: 3000, toolCallId: 'nope' })
    ).toBe(1);
  });
});

describe('refreshPresentApprovalBlocks', () => {
  const inboxBlock = (inboxId: string, status: string) => ({
    id: `b-${inboxId}`,
    type: 'inbox',
    content: '',
    inboxData: { inboxId, status },
  });

  it('已落块的项 ⇒ 就地刷新状态，且不计入 missing（不重复合成）', () => {
    const msg = { id: 'm1', blocks: [inboxBlock('ib-1', 'pending')] };
    const { missing, updatedMessages } = refreshPresentApprovalBlocks(
      [msg],
      [{ id: 'ib-1', status: 'replied' }]
    );

    expect(missing).toEqual([]);
    expect(updatedMessages).toBe(1);
    const data = (msg.blocks[0] as { inboxData: { status: string } }).inboxData;
    expect(data.status).toBe('replied');
  });

  it('未落块的项 ⇒ 进 missing；已有块不受影响', () => {
    const kept = inboxBlock('ib-1', 'expired');
    const msg = { id: 'm1', blocks: [kept] };
    const { missing, updatedMessages } = refreshPresentApprovalBlocks(
      [msg],
      [
        { id: 'ib-1', status: 'expired' },
        { id: 'ib-2', status: 'expired' },
      ]
    );

    expect(missing).toEqual(['ib-2']);
    // 状态没变 ⇒ 不重写该消息
    expect(updatedMessages).toBe(0);
    expect(msg.blocks[0]).toBe(kept);
  });

  it('卡片落较早消息 ⇒ 只改那一处，不搬到最新消息', () => {
    const first = { id: 'm1', blocks: [inboxBlock('ib-1', 'pending')] };
    const second = { id: 'm2', blocks: [{ id: 'b1', type: 'text' }] };
    const { missing, updatedMessages } = refreshPresentApprovalBlocks(
      [first, second],
      [{ id: 'ib-1', status: 'expired' }]
    );

    expect(missing).toEqual([]);
    expect(updatedMessages).toBe(1);
    expect(second.blocks).toHaveLength(1);
    const data = (first.blocks[0] as { inboxData: { status: string } })
      .inboxData;
    expect(data.status).toBe('expired');
  });

  it('无 blocks 的消息与非 inbox 块原样跳过', () => {
    const texts = [{ id: 'm1', blocks: [{ id: 'b1', type: 'text' }] }];
    const { missing, updatedMessages } = refreshPresentApprovalBlocks(texts, [
      { id: 'ib-9', status: 'replied' },
    ]);
    expect(missing).toEqual(['ib-9']);
    expect(updatedMessages).toBe(0);
  });
});
