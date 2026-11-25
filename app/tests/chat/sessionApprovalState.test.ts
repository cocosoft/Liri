/**
 * P1-2 / N-3（2026-11-06）：一轮结束后会话状态收敛的**纯判定**回归锁。
 *
 * - P1-2：`awaiting_approval` ⇒ `requires_action`（列表显示「待审批」）；
 * - N-3：失败收尾 ⇒ `error`，可续中断 ⇒ `paused`（此前一律不写，`GET /v1/sessions/{id}`
 *   永远是 `active`，与"正在跑"无法区分）；
 * - 2026-11-25：`no_progress`（无进展熔断）由失败族**移入可续族** ⇒ `paused`（防"叫停"被当成故障）；
 * - 用户重新发言 ⇒ 可重开态回到 `active`（否则徽标永久挂住）；
 * - 正常完成（`stop` / `completed`）**不改**状态。
 */
import { describe, expect, it } from 'bun:test';
import { resolveSessionStateAfterMessage } from '../../src/chat/manager/messagePersistence';
import { clearAwaitingApprovalTurnMarkers } from '../../src/chat/terminationOutput';
import { DataSessionStatus } from '@modules/session/types/session';
import type { Message } from '@modules/session/types/message';

type Probe = Pick<Message, 'role' | 'metadata' | 'finishReason'>;

/** 最小助手消息探针（收尾原因落 `metadata.finishReason`） */
function assistant(finishReason?: string): Probe {
  return {
    role: 'assistant' as Message['role'],
    metadata: finishReason ? { finishReason } : undefined,
  };
}

/** 收尾原因落 `metadata.terminationReason`（`timeout` / `compaction_failed` 只有这一路） */
function assistantByTermination(reason: string): Probe {
  return {
    role: 'assistant' as Message['role'],
    metadata: { terminationReason: reason },
  };
}

/** 收尾原因落消息顶层（无工具循环时由 StreamPipeline 写 provider stop reason） */
function assistantTopLevel(finishReason: string): Probe {
  return {
    role: 'assistant' as Message['role'],
    finishReason,
  };
}

function user(): Probe {
  return { role: 'user' as Message['role'] };
}

describe('resolveSessionStateAfterMessage（P1-2 / N-3）', () => {
  it('等待审批 ⇒ requires_action（幂等：已是该态则不重复写）', () => {
    expect(
      resolveSessionStateAfterMessage(
        assistant('awaiting_approval'),
        DataSessionStatus.ACTIVE
      )
    ).toBe(DataSessionStatus.REQUIRES_ACTION);
    expect(
      resolveSessionStateAfterMessage(
        assistant('awaiting_approval'),
        DataSessionStatus.REQUIRES_ACTION
      )
    ).toBeNull();
  });

  it('失败收尾 ⇒ error（含熔断/环境阻塞/内部异常）', () => {
    for (const reason of [
      'circuit_breaker',
      'environment_blocked',
      'internal_error',
      'reasoning_error',
      'loop_detected',
    ]) {
      expect(
        resolveSessionStateAfterMessage(
          assistant(reason),
          DataSessionStatus.ACTIVE
        )
      ).toBe(DataSessionStatus.ERROR);
    }
    expect(
      resolveSessionStateAfterMessage(
        assistant('circuit_breaker'),
        DataSessionStatus.ERROR
      )
    ).toBeNull();
  });

  it('可续中断 ⇒ paused（空输出 / 输出预算耗尽 / 额度 / 超时 / 系统中止）', () => {
    for (const reason of [
      'empty_output',
      'output_budget_exhausted',
      'max_turns',
      'budget_exhausted',
      'system_aborted',
      // 2026-11-25：无进展熔断 = 主动停下防空转、会话可续 ⇒ 不再是 `error`
      'no_progress',
    ]) {
      expect(
        resolveSessionStateAfterMessage(
          assistant(reason),
          DataSessionStatus.ACTIVE
        )
      ).toBe(DataSessionStatus.PAUSED);
    }
    // 幂等：已是 `paused` ⇒ 不重复落盘
    expect(
      resolveSessionStateAfterMessage(
        assistant('no_progress'),
        DataSessionStatus.PAUSED
      )
    ).toBeNull();
    // `timeout` / `compaction_failed` 只落 terminationReason
    expect(
      resolveSessionStateAfterMessage(
        assistantByTermination('timeout'),
        DataSessionStatus.ACTIVE
      )
    ).toBe(DataSessionStatus.PAUSED);
    expect(
      resolveSessionStateAfterMessage(
        assistantByTermination('compaction_failed'),
        DataSessionStatus.ACTIVE
      )
    ).toBe(DataSessionStatus.PAUSED);
  });

  it('顶层 finishReason 同样生效（provider 的 error / max_tokens 不误判）', () => {
    expect(
      resolveSessionStateAfterMessage(
        assistantTopLevel('error'),
        DataSessionStatus.ACTIVE
      )
    ).toBe(DataSessionStatus.ERROR);
    expect(
      resolveSessionStateAfterMessage(
        assistantTopLevel('max_tokens'),
        DataSessionStatus.ACTIVE
      )
    ).toBeNull();
  });

  it('正常完成 / 用户主动停止 / 非 assistant ⇒ 不变', () => {
    expect(
      resolveSessionStateAfterMessage(
        assistant('stop'),
        DataSessionStatus.ACTIVE
      )
    ).toBeNull();
    expect(
      resolveSessionStateAfterMessage(
        assistantByTermination('completed'),
        DataSessionStatus.ACTIVE
      )
    ).toBeNull();
    // 用户主动停止本轮：不是故障，不做标记
    expect(
      resolveSessionStateAfterMessage(
        assistant('aborted'),
        DataSessionStatus.ACTIVE
      )
    ).toBeNull();
    expect(
      resolveSessionStateAfterMessage(assistant(), DataSessionStatus.ACTIVE)
    ).toBeNull();
    expect(
      resolveSessionStateAfterMessage(
        { role: 'tool' as Message['role'] },
        DataSessionStatus.ACTIVE
      )
    ).toBeNull();
  });

  it('2026-11-13：正常跑完 ⇒ 清掉上一轮遗留的可重开态（审批通过后的续跑没有新 user）', () => {
    for (const reason of ['stop', 'completed', 'tool_calls', 'tool_use']) {
      expect(
        resolveSessionStateAfterMessage(
          assistantTopLevel(reason),
          DataSessionStatus.REQUIRES_ACTION
        )
      ).toBe(DataSessionStatus.ACTIVE);
    }
    // 已是 active ⇒ 幂等不重复落盘
    expect(
      resolveSessionStateAfterMessage(
        assistant('stop'),
        DataSessionStatus.ACTIVE
      )
    ).toBeNull();
    // 生命周期态不因"跑完"被改写
    expect(
      resolveSessionStateAfterMessage(
        assistant('stop'),
        DataSessionStatus.ARCHIVED
      )
    ).toBeNull();
  });

  it('用户重新发言 ⇒ 可重开态回到 active；生命周期态与已 active 不动', () => {
    for (const state of [
      DataSessionStatus.REQUIRES_ACTION,
      DataSessionStatus.PAUSED,
      DataSessionStatus.ERROR,
    ]) {
      expect(resolveSessionStateAfterMessage(user(), state)).toBe(
        DataSessionStatus.ACTIVE
      );
    }
    expect(
      resolveSessionStateAfterMessage(user(), DataSessionStatus.ACTIVE)
    ).toBeNull();
    expect(
      resolveSessionStateAfterMessage(user(), DataSessionStatus.ARCHIVED)
    ).toBeNull();
    expect(
      resolveSessionStateAfterMessage(user(), DataSessionStatus.ENDED)
    ).toBeNull();
  });
});

/**
 * 2026-11-24（真机 `session_mwrf18pu00456e0f2b`）：用户批准后，续跑写回的是**同一条**助手消息；
 * 若 `awaiting_approval` 收尾标记留在上面，任何后续落盘都会把会话写回 `requires_action`
 * ⇒ 续跑进行中侧栏仍显示「待审批」。根治点 = 续跑开始即清除该标记（`streamResume`）。
 */
describe('续跑清除审批收尾标记 ⇒ 不再被写回 requires_action（2026-11-24）', () => {
  it('对照：未清除时，同一条消息的再次落盘仍判 requires_action', () => {
    expect(
      resolveSessionStateAfterMessage(
        assistant('awaiting_approval'),
        DataSessionStatus.ACTIVE
      )
    ).toBe(DataSessionStatus.REQUIRES_ACTION);
  });

  it('清除标记后 ⇒ 收敛判定不再命中（null）', () => {
    const cleared = clearAwaitingApprovalTurnMarkers({
      role: 'assistant' as Message['role'],
      content: '',
      metadata: { finishReason: 'awaiting_approval' },
    });
    expect(cleared.changed).toBe(true);
    expect(
      resolveSessionStateAfterMessage(
        cleared.message as Probe,
        DataSessionStatus.ACTIVE
      )
    ).toBeNull();
  });
});
