// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * CoreAPIImpl.listSessions — #23（2026-10-30）「列表查询口径」契约锁定。
 *
 * 背景（真机）：对话页列表 31 条 vs 磁盘 32 个会话，且 11 个 `error` / 18 个 `paused`
 * 会话在 UI 上**完全不可见**。拆开看是两件事：
 *   ① 条数差：列表口径里有「幽灵会话过滤」「崩溃空壳过滤」两道过滤，UI 侧另有模块作用域过滤
 *      （跨模块会话本就不该出现在本模块列表）——必须能证明口径，而不是"少了一个"；
 *   ② 状态丢失：列表**只投影内存态**，而 `mapSessionStatusToState` 当时缺 `error` 映射
 *      ⇒ 出错会话被显示成正常会话。
 *
 * 本测试把「一条磁盘会话 → 一条列表项」的口径钉死：幽灵过滤、空壳过滤、空会话保留、
 * `status` 取持久层、`messageCount` 不计工具记录。
 */

import { describe, it, expect } from 'bun:test';
import { CoreAPIImpl } from '../../src/runtime/api/CoreAPIImpl.js';

type CoreAPIOptions = NonNullable<ConstructorParameters<typeof CoreAPIImpl>[0]>;
type ChatManagerLike = NonNullable<CoreAPIOptions['chatManager']>;

interface FakeMessage {
  role: string;
}

interface FakeChatSession {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  /** 进程内存态（可能是失真的：见 status 用例） */
  state: string;
  messages: FakeMessage[];
  metadata: Record<string, unknown>;
}

function mkSession(
  id: string,
  opts: {
    messages?: FakeMessage[];
    metadata?: Record<string, unknown>;
    state?: string;
  } = {}
): FakeChatSession {
  const at = new Date('2026-10-30T00:00:00Z');
  return {
    id,
    title: `title-${id}`,
    createdAt: at,
    updatedAt: at,
    state: opts.state ?? 'active',
    messages: opts.messages ?? [{ role: 'user' }, { role: 'assistant' }],
    metadata: opts.metadata ?? { projectId: 'proj_test' },
  };
}

/**
 * @param inMemory 进程内存里的会话（`getSessions()` 的返回值）
 * @param onDisk   持久层仍存在的会话 id → 持久化状态；缺失即"磁盘目录已消失"（幽灵）
 */
function makeFixture(
  inMemory: FakeChatSession[],
  onDisk: Record<string, { status: string }>
) {
  const chatManager = {
    getSessionManager: () => ({
      getSessions: () => inMemory,
      getSession: (id: string) => inMemory.find((s) => s.id === id),
    }),
    getSessionGateway: () => ({
      getSession: async (id: string) => {
        const stored = onDisk[id];
        if (!stored) return null;
        return { id, status: stored.status };
      },
    }),
  };
  const api = new CoreAPIImpl({
    chatManager: chatManager as unknown as ChatManagerLike,
  });
  return { api };
}

describe('CoreAPIImpl.listSessions（#23 列表查询口径）', () => {
  it('无幽灵、无空壳时：磁盘会话数 == 接口返回数', async () => {
    const sessions = [mkSession('a'), mkSession('b'), mkSession('c')];
    const { api } = makeFixture(sessions, {
      a: { status: 'active' },
      b: { status: 'paused' },
      c: { status: 'error' },
    });

    const list = await api.listSessions();

    expect(list.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(list).toHaveLength(sessions.length);
  });

  it('持久层已消失的幽灵会话被过滤（内存 Map 未同步删除）', async () => {
    const sessions = [mkSession('a'), mkSession('ghost')];
    const { api } = makeFixture(sessions, { a: { status: 'active' } });

    const list = await api.listSessions();

    expect(list.map((s) => s.id)).toEqual(['a']);
  });

  it('崩溃空壳（0 条对话消息 + crashRecovery 标记）被过滤', async () => {
    const shell = mkSession('shell', {
      messages: [],
      metadata: { crashRecovery: true },
    });
    const { api } = makeFixture([shell, mkSession('ok')], {
      shell: { status: 'active' },
      ok: { status: 'active' },
    });

    const list = await api.listSessions();

    expect(list.map((s) => s.id)).toEqual(['ok']);
  });

  it('0 条消息但没有崩溃标记的空会话**保留**（折叠是前端职责，不在查询侧丢弃）', async () => {
    const empty = mkSession('empty', { messages: [] });
    const { api } = makeFixture([empty], { empty: { status: 'paused' } });

    const list = await api.listSessions();

    expect(list).toHaveLength(1);
    expect(list[0].messageCount).toBe(0);
    expect(list[0].status).toBe('paused');
  });

  it('status 取持久层而非内存态（内存态对 error 失真时仍如实上报）', async () => {
    const errored = mkSession('errored', { state: 'active' });
    const { api } = makeFixture([errored], {
      errored: { status: 'error' },
    });

    const list = await api.listSessions();

    expect(list[0].status).toBe('error');
  });

  it('messageCount 只计 user/assistant（工具记录不计入）', async () => {
    const withTools = mkSession('with-tools', {
      messages: [
        { role: 'user' },
        { role: 'assistant' },
        { role: 'tool' },
        { role: 'tool' },
        { role: 'user' },
      ],
    });
    const { api } = makeFixture([withTools], {
      'with-tools': { status: 'active' },
    });

    const list = await api.listSessions();

    expect(list[0].messageCount).toBe(3);
    expect(list[0].roundCount).toBe(2);
  });
});
