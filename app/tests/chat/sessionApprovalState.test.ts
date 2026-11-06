/**
 * P1-2（2026-11-06）：会话状态随「等待审批」推进的**纯判定**回归锁。
 *
 * 真机问题：回合以 `awaiting_approval` 收尾时会话状态仍是 `active` ⇒ 会话列表看不出
 * "卡在等你批"（也无法与"正在跑"区分）。这里锁两条迁移：
 *   ① assistant 带 `metadata.finishReason='awaiting_approval'` ⇒ `requires_action`；
 *   ② 用户重新发言 ⇒ 从 `requires_action` 回到 `active`（其余场景一律不变）。
 */
import { describe, expect, it } from 'bun:test';
import { resolveApprovalSessionState } from '../../src/chat/manager/messagePersistence';
import { DataSessionStatus } from '../../src/session/types/session';
import type { Message } from '../../src/session/types/message';

/** 最小消息探针（`MessageRole` 是枚举 ⇒ 角色字面量需按契约收窄） */
function probe(
  role: string,
  finishReason?: string
): Pick<Message, 'role' | 'metadata'> {
  return {
    role: role as Message['role'],
    metadata: finishReason ? { finishReason } : undefined,
  };
}

describe('resolveApprovalSessionState（P1-2）', () => {
  it('等待审批 ⇒ requires_action（幂等：已是该态则不重复写）', () => {
    expect(
      resolveApprovalSessionState(
        probe('assistant', 'awaiting_approval'),
        DataSessionStatus.ACTIVE
      )
    ).toBe(DataSessionStatus.REQUIRES_ACTION);
    expect(
      resolveApprovalSessionState(
        probe('assistant', 'awaiting_approval'),
        DataSessionStatus.REQUIRES_ACTION
      )
    ).toBeNull();
  });

  it('普通停止 / 非 assistant ⇒ 不变', () => {
    expect(
      resolveApprovalSessionState(
        probe('assistant', 'stop'),
        DataSessionStatus.ACTIVE
      )
    ).toBeNull();
    expect(
      resolveApprovalSessionState(probe('tool'), DataSessionStatus.ACTIVE)
    ).toBeNull();
    expect(
      resolveApprovalSessionState(probe('assistant'), DataSessionStatus.ACTIVE)
    ).toBeNull();
  });

  it('用户重新发言 ⇒ 从 requires_action 回到 active；其余用户消息不变', () => {
    expect(
      resolveApprovalSessionState(
        probe('user'),
        DataSessionStatus.REQUIRES_ACTION
      )
    ).toBe(DataSessionStatus.ACTIVE);
    expect(
      resolveApprovalSessionState(probe('user'), DataSessionStatus.ACTIVE)
    ).toBeNull();
  });
});
