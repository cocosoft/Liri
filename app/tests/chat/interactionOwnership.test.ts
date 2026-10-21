/**
 * 多租户 P3：交互解析的会话归属校验
 *
 * `resolveInteraction` 会**写入回答消息**并唤醒等待中的工具（等同一次审批动作）。
 * 会话网关按身份分区 ⇒ 看不到该会话即拒绝（fail-closed），既不落盘也不唤醒。
 */
import { describe, expect, it } from 'bun:test';

import { ChatRollback } from '../../src/chat/manager/rollback';
import type { SessionGateway } from '../../src/session/SessionGateway';
import type { MessageService } from '../../src/chat/services/MessageService';
import {
  createPendingInteractionEntry,
  type PendingInteractionEntry,
} from '../../src/utils/pendingInteractions';

interface Harness {
  rollback: ChatRollback;
  pending: Map<string, PendingInteractionEntry>;
  resolvedAnswers: string[][];
  persisted: string[];
}

function makeHarness(options: { visibleSession: boolean }): Harness {
  const pending = new Map<string, PendingInteractionEntry>();
  const resolvedAnswers: string[][] = [];
  const persisted: string[] = [];

  let resolveEntry: (answers: string[]) => void = () => {};
  const promise = new Promise<string[]>((res) => {
    resolveEntry = res;
  });
  pending.set(
    's1',
    createPendingInteractionEntry({
      questionId: 'q1',
      promise,
      resolve: (answers) => {
        resolvedAnswers.push(answers);
        resolveEntry(answers);
      },
    })
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
});
