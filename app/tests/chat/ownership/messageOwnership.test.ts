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
  getSessionOwner,
  resolveMessageOwnership,
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
