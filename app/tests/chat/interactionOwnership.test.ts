/**
 * 多租户 P3：交互条目的归属校验
 *
 * ① `resolveInteraction` 会**写入回答消息**并唤醒等待中的工具（等同一次审批动作）
 *    ⇒ 会话不可见、或条目不属于当前身份，都拒绝（fail-closed）；
 * ② 条目在创建时自动写入归属键；`hasActivePendingInteraction` 对他人条目视为"无挂起"。
 */
import { describe, expect, it } from 'bun:test';

import { ChatRollback } from '../../src/chat/manager/rollback';
import type { SessionGateway } from '../../src/session/SessionGateway';
import type { MessageService } from '../../src/chat/services/MessageService';
import type { Principal } from '@modules/core/identity/principal';
import { runWithPrincipal } from '@modules/core/identity/requestScope';
import {
  createPendingInteractionEntry,
  hasActivePendingInteraction,
  type PendingInteractionEntry,
} from '../../src/utils/pendingInteractions';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

interface Harness {
  rollback: ChatRollback;
  pending: Map<string, PendingInteractionEntry>;
  resolvedAnswers: string[][];
  persisted: string[];
}

function makeHarness(options: {
  visibleSession: boolean;
  /** 条目创建时的身份（缺省 ⇒ 本地，不写归属） */
  owner?: Principal;
}): Harness {
  const pending = new Map<string, PendingInteractionEntry>();
  const resolvedAnswers: string[][] = [];
  const persisted: string[] = [];

  let resolveEntry: (answers: string[]) => void = () => {};
  const promise = new Promise<string[]>((res) => {
    resolveEntry = res;
  });
  const createEntry = () =>
    createPendingInteractionEntry({
      questionId: 'q1',
      promise,
      resolve: (answers) => {
        resolvedAnswers.push(answers);
        resolveEntry(answers);
      },
    });
  // 多租户 P3：条目在**创建者身份**下生成 ⇒ `ownerKey` 由工厂自动写入
  pending.set(
    's1',
    options.owner ? runWithPrincipal(options.owner, createEntry) : createEntry()
  );

  const rollback = new ChatRollback({
    getPendingInteractions: () => pending,
    getMessageService: () =>
      ({
        createUserMessage: (content: string) => ({
          id: 'm-answer',
          role: 'user',
          content,
        }),
      }) as unknown as MessageService,
    addAndPersistMessage: async (_sid, message) => {
      persisted.push(String(message.content));
    },
    getRollbackIntegrations: () => new Map(),
    getPermissionManager: () => null,
    getSessionGateway: () =>
      ({
        getSession: async () => (options.visibleSession ? { id: 's1' } : null),
      }) as unknown as SessionGateway,
  });

  return { rollback, pending, resolvedAnswers, persisted };
}

describe('交互解析归属校验（P3）', () => {
  it('会话在当前身份不可见 ⇒ 拒绝解析，且不落盘、不唤醒', async () => {
    const harness = makeHarness({ visibleSession: false });

    const ok = await harness.rollback.resolveInteraction('q1', ['yes'], 's1');

    expect(ok).toBe(false);
    expect(harness.pending.has('s1')).toBe(true);
    expect(harness.resolvedAnswers).toEqual([]);
    expect(harness.persisted).toEqual([]);
  });

  it('会话可见 ⇒ 正常落盘并唤醒', async () => {
    const harness = makeHarness({ visibleSession: true });

    const ok = await harness.rollback.resolveInteraction('q1', ['yes'], 's1');

    expect(ok).toBe(true);
    expect(harness.resolvedAnswers).toEqual([['yes']]);
    expect(harness.persisted).toEqual(['yes']);
    expect(harness.pending.has('s1')).toBe(false);
  });

  it('条目创建时自动写入归属键；他人视为"无挂起"', () => {
    const pending = new Map<string, PendingInteractionEntry>();
    runWithPrincipal(ALICE, () =>
      pending.set(
        's1',
        createPendingInteractionEntry({
          questionId: 'q1',
          promise: Promise.resolve([]),
          resolve: () => {},
        })
      )
    );

    expect(pending.get('s1')?.ownerKey).toBe('acme:alice');
    expect(
      runWithPrincipal(ALICE, () => hasActivePendingInteraction(pending, 's1'))
    ).toBe(true);
    expect(
      runWithPrincipal(BOB, () => hasActivePendingInteraction(pending, 's1'))
    ).toBe(false);
    // 本地身份恒放行（单用户基线，含无归属的历史条目）
    expect(hasActivePendingInteraction(pending, 's1')).toBe(true);
  });

  it('他人解析同一 sessionId + questionId ⇒ 拒绝且不唤醒（即使会话可见）', async () => {
    const harness = makeHarness({ visibleSession: true, owner: ALICE });

    const ok = await runWithPrincipal(BOB, () =>
      harness.rollback.resolveInteraction('q1', ['yes'], 's1')
    );

    expect(ok).toBe(false);
    expect(harness.resolvedAnswers).toEqual([]);
    expect(harness.persisted).toEqual([]);
    expect(harness.pending.has('s1')).toBe(true);
  });
});
