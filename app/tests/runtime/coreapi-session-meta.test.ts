/**
 * CoreAPIImpl.updateSessionMeta — 会话置顶（M1-T1.3）契约锁定
 *
 * 核心不变量：
 *   ① pinned-only 更新**不 touch updatedAt**（列表不因置顶操作重排）
 *   ② meta 字段（model/workspaceId/providerId/tasksOverride）更新 touch updatedAt
 *   ③ pinned 与 meta 字段同时更新时 updatedAt 刷新（pinned 不抑制 touch）
 *   ④ 内存 session 与 gateway 持久层双侧同步写入 pinned
 */

import { describe, it, expect } from 'bun:test';
import { CoreAPIImpl } from '../../src/runtime/api/CoreAPIImpl.js';

type CoreAPIOptions = NonNullable<ConstructorParameters<typeof CoreAPIImpl>[0]>;
type ChatManagerLike = NonNullable<CoreAPIOptions['chatManager']>;

interface FakeSession {
  id: string;
  updatedAt: Date;
  metadata: Record<string, unknown>;
}

function makeFixture(persisted: boolean) {
  const memSession: FakeSession = {
    id: 'sess-1',
    updatedAt: new Date('2026-08-31T00:00:00Z'),
    metadata: { title: 't' },
  };
  const storedSession: FakeSession = {
    id: 'sess-1',
    updatedAt: new Date('2026-08-31T00:00:00Z'),
    metadata: { title: 't' },
  };
  const updateSessionCalls: FakeSession[] = [];
  const chatManager = {
    getSessions: () => (persisted ? [memSession] : []),
    getSessionManager: () => ({}),
    getSessionGateway: () =>
      persisted
        ? {
            getSession: async () => storedSession,
            updateSession: async (s: FakeSession) => {
              updateSessionCalls.push(s);
            },
          }
        : null,
  };

  const api = new CoreAPIImpl({
    chatManager: chatManager as unknown as ChatManagerLike,
  });
  return { api, memSession, storedSession, updateSessionCalls };
}

describe('CoreAPIImpl.updateSessionMeta 置顶契约（M1-T1.3）', () => {
  it('① pinned-only 更新：metadata.pinned 翻转且 updatedAt 不变', async () => {
    const { api, memSession, storedSession, updateSessionCalls } =
      makeFixture(true);
    const before = memSession.updatedAt.getTime();

    await api.updateSessionMeta('sess-1', { pinned: true });

    expect(memSession.metadata.pinned).toBe(true);
    expect(memSession.updatedAt.getTime()).toBe(before);
    expect(updateSessionCalls.length).toBe(1);
    expect(storedSession.metadata.pinned).toBe(true);
    expect(storedSession.updatedAt.getTime()).toBe(before);
  });

  it('② meta 字段（model）更新：updatedAt 刷新', async () => {
    const { api, memSession } = makeFixture(true);
    const before = memSession.updatedAt.getTime();

    await api.updateSessionMeta('sess-1', { model: 'm-1' });

    expect(memSession.metadata.model).toBe('m-1');
    expect(memSession.updatedAt.getTime()).toBeGreaterThan(before);
  });

  it('③ pinned=false 明确取消：pinned 置 false 且 updatedAt 不变', async () => {
    const { api, memSession } = makeFixture(true);
    memSession.metadata.pinned = true;
    const before = memSession.updatedAt.getTime();

    await api.updateSessionMeta('sess-1', { pinned: false });

    expect(memSession.metadata.pinned).toBe(false);
    expect(memSession.updatedAt.getTime()).toBe(before);
  });

  it('④ pinned + model 同时更新：updatedAt 刷新（pinned 不抑制 touch）', async () => {
    const { api, memSession } = makeFixture(true);
    const before = memSession.updatedAt.getTime();

    await api.updateSessionMeta('sess-1', { pinned: true, model: 'm-1' });

    expect(memSession.metadata.pinned).toBe(true);
    expect(memSession.updatedAt.getTime()).toBeGreaterThan(before);
  });

  it('⑤ 会话不在内存（未持久化）：不抛错、静默跳过', async () => {
    const { api } = makeFixture(false);
    await api.updateSessionMeta('sess-missing', { pinned: true });
  });
});
