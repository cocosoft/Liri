/**
 * pendingInteractions —— 单槽条目的 TTL 自愈（源码排查报告 S4）。
 *
 * 判据 `hasActivePendingInteraction()` 命中过期条目时必须**就地删除**，
 * 否则该会话会一直被视为「已有待处理交互」而永久拒绝新的交互工具。
 */
import { describe, expect, it } from 'bun:test';

import { PENDING_INTERACTION_TTL_MS } from '../../src/constants/common.js';
import {
  createPendingInteractionEntry,
  hasActivePendingInteraction,
  type PendingInteractionEntry,
} from '../../src/utils/pendingInteractions.js';

function makeFields(): Omit<PendingInteractionEntry, 'expiresAt'> {
  return {
    questionId: 'q1',
    promise: Promise.resolve(['yes']),
    resolve: () => {},
  };
}

describe('createPendingInteractionEntry', () => {
  it('默认 TTL = 5 分钟', () => {
    const entry = createPendingInteractionEntry(makeFields(), undefined, 1_000);
    expect(entry.expiresAt).toBe(1_000 + PENDING_INTERACTION_TTL_MS);
  });

  it('非法 ttl（<=0 / 非有限）回落默认 TTL', () => {
    expect(
      createPendingInteractionEntry(makeFields(), 0, 1_000).expiresAt
    ).toBe(1_000 + PENDING_INTERACTION_TTL_MS);
    expect(
      createPendingInteractionEntry(makeFields(), Number.NaN, 1_000).expiresAt
    ).toBe(1_000 + PENDING_INTERACTION_TTL_MS);
  });

  it('自定义 ttl 生效', () => {
    expect(
      createPendingInteractionEntry(makeFields(), 2_000, 1_000).expiresAt
    ).toBe(3_000);
  });
});

describe('hasActivePendingInteraction', () => {
  it('未过期 ⇒ true 且保留条目', () => {
    const map = new Map<string, PendingInteractionEntry>();
    map.set('s1', createPendingInteractionEntry(makeFields(), 1_000, 1_000));

    expect(hasActivePendingInteraction(map, 's1', 1_500)).toBe(true);
    expect(map.has('s1')).toBe(true);
  });

  it('已过期 ⇒ false 且就地删除（自愈）', () => {
    const map = new Map<string, PendingInteractionEntry>();
    map.set('s1', createPendingInteractionEntry(makeFields(), 1_000, 1_000));

    expect(hasActivePendingInteraction(map, 's1', 2_001)).toBe(false);
    expect(map.has('s1')).toBe(false);
  });

  it('无 Map / 无该会话 ⇒ false', () => {
    expect(hasActivePendingInteraction(undefined, 's1')).toBe(false);
    expect(
      hasActivePendingInteraction(
        new Map<string, PendingInteractionEntry>(),
        's1'
      )
    ).toBe(false);
  });
});
