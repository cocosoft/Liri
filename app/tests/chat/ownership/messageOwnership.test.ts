/**
 * P36-b · 消息归属判定（纯函数 + 读侧投影）
 *
 * 覆盖方案 §3/§4 的验收口径：
 * ① 判定表 4 行（空闲 / 自主持有 / 人工持有 / 占用不可归属）；
 * ② 投影：`ticket_assignments` 的最新 `running` 派工决定 kind 与 ownerTicketId，
 *    `ended` ⇒ 交还（`none`），重复交还幂等；
 * ③ loader 未注入 / 抛错 ⇒ `none`（如实不可归属，不猜）。
 */
import { describe, it, expect } from 'bun:test';

import {
  ExecutionManager,
  emitOwnershipDecision,
  getSessionOwner,
  resolveMessageOwnership,
  setExecutionEventSink,
  setSessionOwnerLoader,
} from '@openliri/service/execution';
import {
  resolveSessionOwner,
  type AssignmentLike,
} from '../../../src/chat/ownership/resolveSessionOwner';

function assignment(over: Partial<AssignmentLike> = {}): AssignmentLike {
  return {
    executor: 'alwayson',
    state: 'running',
    workItemId: 'w-1',
    ...over,
  };
}

describe('resolveMessageOwnership（判定表）', () => {
  it('空闲 ⇒ accept', () => {
    expect(
      resolveMessageOwnership({ occupied: false, ownerKind: 'autonomous' })
    ).toEqual({ action: 'accept', reason: 'session_free' });
  });

  it('自主持有 ⇒ queue（不顶替执行器）', () => {
    expect(
      resolveMessageOwnership({ occupied: true, ownerKind: 'autonomous' })
    ).toEqual({ action: 'queue', reason: 'owner_autonomous' });
  });

  it('人工持有 ⇒ queue（既有排队语义）', () => {
    expect(
      resolveMessageOwnership({ occupied: true, ownerKind: 'manual' })
    ).toEqual({ action: 'queue', reason: 'owner_manual' });
  });

  it('占用但不可归属（外部/前进程执行）⇒ queue/occupied_unknown', () => {
    expect(
      resolveMessageOwnership({ occupied: true, ownerKind: 'none' })
    ).toEqual({ action: 'queue', reason: 'occupied_unknown' });
  });
});

describe('resolveSessionOwner（读侧投影）', () => {
  it('最新 running 派工 ⇒ 自主持有 + ownerTicketId', async () => {
    const owner = await resolveSessionOwner('s1', async () => [
      assignment({ state: 'ended', workItemId: 'old' }),
      assignment({ state: 'running', workItemId: 'w-2' }),
    ]);
    expect(owner).toEqual({ kind: 'autonomous', ticketId: 'w-2' });
  });

  it('派工 id 随持有者下发（P34 产物绑定用）', async () => {
    const owner = await resolveSessionOwner('s1', async () => [
      assignment({ workItemId: 'w-3', assignmentId: 'as-3' }),
    ]);
    expect(owner).toEqual({
      kind: 'autonomous',
      ticketId: 'w-3',
      assignmentId: 'as-3',
    });
  });

  it('executor=manual ⇒ manual', async () => {
    const owner = await resolveSessionOwner('s1', async () => [
      assignment({ executor: 'manual' }),
    ]);
    expect(owner.kind).toBe('manual');
  });

  it('无 running（已交还）⇒ none（重复交还幂等）', async () => {
    const rows = [assignment({ state: 'ended' })];
    expect((await resolveSessionOwner('s1', async () => rows)).kind).toBe(
      'none'
    );
    expect((await resolveSessionOwner('s1', async () => rows)).kind).toBe(
      'none'
    );
  });

  it('读取失败 ⇒ none（不把观测面失败升级为消息失败）', async () => {
    const owner = await resolveSessionOwner('s1', async () => {
      throw new Error('db down');
    });
    expect(owner).toEqual({ kind: 'none' });
  });

  it('空 sessionId ⇒ none（不做无意义查库）', async () => {
    let called = 0;
    const owner = await resolveSessionOwner('', async () => {
      called += 1;
      return [];
    });
    expect(owner.kind).toBe('none');
    expect(called).toBe(0);
  });
});

describe('getSessionOwner（宿主注入端口）', () => {
  it('未注入 ⇒ none（行为等于改造前）', async () => {
    setSessionOwnerLoader(null);
    expect(await getSessionOwner('s1')).toEqual({ kind: 'none' });
  });

  it('注入后透传；loader 抛错 ⇒ none', async () => {
    setSessionOwnerLoader(async (sid) =>
      sid === 's1' ? { kind: 'autonomous', ticketId: 'w-9' } : { kind: 'none' }
    );
    expect(await getSessionOwner('s1')).toEqual({
      kind: 'autonomous',
      ticketId: 'w-9',
    });
    expect(await getSessionOwner('s2')).toEqual({ kind: 'none' });

    setSessionOwnerLoader(async () => {
      throw new Error('boom');
    });
    expect(await getSessionOwner('s1')).toEqual({ kind: 'none' });
    setSessionOwnerLoader(null);
  });
});

/**
 * P36 验收用例（2026-11-02）：**stop → 承接**
 *
 * 用真实 `ExecutionManager`（租约）+ 派工投影（持有者）+ 判定表（动作）串成一条完整链路：
 * ① 执行器持有期间，人的消息只能 `queue`（accept 被拒）；
 * ② 人喊停（`requestCancel` → `confirmCancel`）+ 执行器交还（派工写 `ended`）；
 * ③ 交还后的下一条消息 ⇒ `accept`（主循环承接），且两次判定都留在 `execution/ownership_decision`。
 */
describe('stop → 承接（P36 用例）', () => {
  it('持有期只能排队；喊停交还后下一条消息被承接', async () => {
    const events: Array<{
      type: string;
      action?: unknown;
      reason?: unknown;
    }> = [];
    setExecutionEventSink(async (_sessionId, event) => {
      // 同一 sink 也承接 `execution/status_changed`；本用例只关心归属判定
      if (event.type !== 'execution/ownership_decision') {
        return { ok: true, tailSeq: 0 };
      }
      const data = event.data as { action?: unknown; reason?: unknown };
      events.push({
        type: event.type,
        action: data.action,
        reason: data.reason,
      });
      return { ok: true, tailSeq: 0 };
    });

    try {
      const manager = new ExecutionManager();
      // 派工投影的假实现：`running` → 人喊停后由执行器改写 `ended`
      let assignmentState: 'running' | 'ended' = 'running';
      const load = async () => [
        { executor: 'alwayson', state: assignmentState, workItemId: 'w-1' },
      ];

      // ① 执行器持有：执行 RUNNING + 派工 running
      const executorLease = manager.acquire('s1', 'alwayson-turn', 'w-1');
      expect(executorLease.isCurrent()).toBe(true);

      // ② 持有期间人的消息：领取失败（QUEUED）⇒ 判定 queue（accept 被拒）
      const humanLease1 = manager.acquire('s1', 'human-1');
      const owner1 = await resolveSessionOwner('s1', load);
      const decision1 = resolveMessageOwnership({
        occupied: !humanLease1.isCurrent(),
        ownerKind: owner1.kind,
      });
      emitOwnershipDecision({
        sessionId: 's1',
        executionId: humanLease1.executionId,
        decision: decision1,
        ownerKind: owner1.kind,
        ownerTicketId: owner1.ticketId,
        messageId: 'human-1',
      });
      expect(owner1).toEqual({ kind: 'autonomous', ticketId: 'w-1' });
      expect(decision1).toEqual({
        action: 'queue',
        reason: 'owner_autonomous',
      });

      // ③ 人喊停：两段式取消确认 ⇒ 所有权释放；执行器交还（派工 ended）
      expect(
        manager.requestCancel(executorLease.executionId, 'user_stop')
      ).toBe(true);
      expect(manager.confirmCancel(executorLease.executionId)).toBe(true);
      assignmentState = 'ended';

      // ④ 交还后的下一条消息：领取成功 ⇒ accept（承接）
      const humanLease2 = manager.acquire('s1', 'human-2');
      const owner2 = await resolveSessionOwner('s1', load);
      const decision2 = resolveMessageOwnership({
        occupied: !humanLease2.isCurrent(),
        ownerKind: owner2.kind,
      });
      emitOwnershipDecision({
        sessionId: 's1',
        executionId: humanLease2.executionId,
        decision: decision2,
        ownerKind: owner2.kind,
        messageId: 'human-2',
      });
      expect(owner2).toEqual({ kind: 'none' });
      expect(decision2).toEqual({ action: 'accept', reason: 'session_free' });

      // ⑤ 审计链完整：queue（持有期）→ accept（交还后）
      expect(events).toEqual([
        {
          type: 'execution/ownership_decision',
          action: 'queue',
          reason: 'owner_autonomous',
        },
        {
          type: 'execution/ownership_decision',
          action: 'accept',
          reason: 'session_free',
        },
      ]);

      humanLease2.release();
    } finally {
      setExecutionEventSink(null);
    }
  });
});
