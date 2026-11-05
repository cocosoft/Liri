// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P0-1（2026-11-04）：把合并次数回填到会话内 Inbox 卡片块（显示 ×N）。
 *
 * 纯函数：只改目标 `inboxId` 的块，其余块**原样保留**（引用不变）；计数相同 ⇒ `changed=false`
 * （调用方据此跳过写盘，避免每次合并都重写整条消息）。
 */
import { describe, it, expect } from 'bun:test';
import {
  patchInboxBlockDedupCount,
  type InboxBlockLike,
} from '@openliri/service/runtime/inboxBlockPatch';

const textBlock: InboxBlockLike = { id: 'b0', type: 'text', content: 'hello' };
const target: InboxBlockLike = {
  id: 'b1',
  type: 'inbox',
  content: '',
  inboxData: { inboxId: 'ib-1', status: 'pending', dedupCount: 1 },
};
const other: InboxBlockLike = {
  id: 'b2',
  type: 'inbox',
  content: '',
  inboxData: { inboxId: 'ib-2', status: 'pending' },
};

describe('P0-1：Inbox 块合并次数回填', () => {
  it('命中目标块 ⇒ 写入 dedupCount；其它块引用不变', () => {
    const { blocks, changed } = patchInboxBlockDedupCount(
      [textBlock, target, other],
      'ib-1',
      3
    );
    expect(changed).toBe(true);
    expect((blocks[1].inboxData as { dedupCount?: number }).dedupCount).toBe(3);
    expect(blocks[0]).toBe(textBlock);
    expect(blocks[2]).toBe(other);
    // 不可变：原块未被就地修改
    expect((target.inboxData as { dedupCount?: number }).dedupCount).toBe(1);
  });

  it('计数相同 ⇒ changed=false（不触发写盘）', () => {
    const { changed } = patchInboxBlockDedupCount([target], 'ib-1', 1);
    expect(changed).toBe(false);
  });

  it('无匹配 inboxId ⇒ changed=false，块数组逐项原样', () => {
    const { blocks, changed } = patchInboxBlockDedupCount(
      [textBlock, target],
      'ib-absent',
      5
    );
    expect(changed).toBe(false);
    expect(blocks[0]).toBe(textBlock);
    expect(blocks[1]).toBe(target);
  });

  it('非 inbox 类型即使 inboxData 同 id 也不动（类型优先）', () => {
    const disguised = {
      id: 'b3',
      type: 'tool',
      inboxData: { inboxId: 'ib-1', dedupCount: 1 },
    };
    const { changed } = patchInboxBlockDedupCount([disguised], 'ib-1', 2);
    expect(changed).toBe(false);
  });
});
