/**
 * 多租户 P3：会话内存缓存的归属校验
 *
 * `SessionLifecycleManager.chatSessions` 是**进程级** Map（键只有 sessionId），
 * 命中缓存时若不复核归属，并发请求会直接拿到别人的会话对象
 * （含消息、工作区路径、待交互状态）—— 而这层缓存绕过了 P1 的存储分区。
 *
 * 本用例锁三件事：
 *  ① 本地身份（桌面 / 后台）恒可复用缓存（零变更）；
 *  ② 归属者本人可复用；
 *  ③ 他人命中**同一 sessionId** ⇒ 抛 `SESSION_FORBIDDEN`（fail-closed，既不返回也不新建）。
 */
import { describe, expect, it } from 'bun:test';

import type { ChatSession } from '../../src/session/types/session';
import { DataSessionStatus } from '@modules/core';
import type { Principal } from '@modules/core/identity/principal';
import { runWithPrincipal } from '@modules/core/identity/requestScope';
import { SessionLifecycleManager } from '../../src/chat/services/SessionLifecycleManager';
import type { SessionGateway } from '../../src/session/SessionGateway';
import type { SessionAccessFacade } from '../../src/chat/services/SessionAccessFacade';
import type { HookChainManager } from '../../src/hooks';
import type { MessageService } from '../../src/chat/services/MessageService';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

function makeSession(owner?: {
  tenantId: string;
  userId: string;
}): ChatSession {
  return {
    id: 's-cache-1',
    title: 'demo',
    state: DataSessionStatus.ACTIVE,
    metadata: owner ? { title: 'demo', owner } : { title: 'demo' },
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as ChatSession;
}

/** 只走缓存分支 ⇒ 其余依赖可用空替身（缓存未命中才会被调用） */
function makeLifecycle(
  session: ChatSession | ChatSession[],
  messageService: unknown = {}
): SessionLifecycleManager {
  const sessions = Array.isArray(session) ? session : [session];
  return new SessionLifecycleManager({
    chatSessions: new Map(sessions.map((item) => [item.id, item])),
    currentSessionIdRef: { get: () => null, set: () => {} },
    sessionLeaveTimes: new Map(),
    sessionMutexes: new Map(),
    sessionAbortControllers: new Map(),
    sessionGateway: {} as unknown as SessionGateway,
    sessionAccess: {} as unknown as SessionAccessFacade,
    hookChainManager: {} as unknown as HookChainManager,
    messageService: messageService as MessageService,
  });
}

describe('会话内存缓存归属校验（P3）', () => {
  it('本地身份恒可复用（含无归属的历史会话）', async () => {
    const withOwner = makeLifecycle(
      makeSession({ tenantId: 'acme', userId: 'alice' })
    );
    const withoutOwner = makeLifecycle(makeSession());

    expect((await withOwner.getOrLoadSession('s-cache-1')).id).toBe(
      's-cache-1'
    );
    expect((await withoutOwner.getOrLoadSession('s-cache-1')).id).toBe(
      's-cache-1'
    );
  });

  it('归属者本人可复用；他人命中同一 id ⇒ SESSION_FORBIDDEN', async () => {
    const lifecycle = makeLifecycle(
      makeSession({ tenantId: 'acme', userId: 'alice' })
    );

    const alice = await runWithPrincipal(ALICE, () =>
      lifecycle.getOrLoadSession('s-cache-1')
    );
    expect(alice.id).toBe('s-cache-1');

    let error: unknown;
    try {
      await runWithPrincipal(BOB, () =>
        lifecycle.getOrLoadSession('s-cache-1')
      );
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      'does not belong to the current identity'
    );
  });
});

/**
 * 2026-10-23：`getSessionMessages` / `searchMessages` 此前只做 map 查表、不校验归属，
 * `brief` / `insights` 等按 `session_id` 读消息的命令可跨身份读取他人会话。
 * 现在与 `getOrLoadSession` 同口径（本地恒放行；已认证必须归属一致；无归属 ⇒ 拒绝）。
 */
describe('会话消息读取归属校验（P3，2026-10-23）', () => {
  const PRIVATE_MESSAGE = {
    id: 'm-private-1',
    role: 'user',
    content: 'alice 的私密内容',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as ChatSession['messages'][number];

  function makeSessionWithMessages(): ChatSession {
    const session = makeSession({ tenantId: 'acme', userId: 'alice' });
    session.messages = [PRIVATE_MESSAGE];
    return session;
  }

  it('getSessionMessages：归属者可读，他人 ⇒ 空数组', async () => {
    const lifecycle = makeLifecycle(makeSessionWithMessages());

    const own = await runWithPrincipal(ALICE, async () =>
      lifecycle.getSessionMessages('s-cache-1')
    );
    expect(own).toHaveLength(1);
    expect(own[0].id).toBe('m-private-1');

    const other = await runWithPrincipal(BOB, async () =>
      lifecycle.getSessionMessages('s-cache-1')
    );
    expect(other).toEqual([]);
  });

  it('getSessionMessages：本地身份恒可读（含无归属的历史会话）', () => {
    const owned = makeLifecycle(makeSessionWithMessages());
    expect(owned.getSessionMessages('s-cache-1')).toHaveLength(1);

    const legacy = makeSession();
    legacy.messages = [PRIVATE_MESSAGE];
    const legacyLifecycle = makeLifecycle(legacy);
    expect(legacyLifecycle.getSessionMessages('s-cache-1')).toHaveLength(1);
  });

  it('searchMessages：指定 sessionId 时他人 ⇒ 空数组', async () => {
    const search = (messages: unknown[]) => messages;
    const lifecycle = makeLifecycle(makeSessionWithMessages(), {
      searchMessages: search,
    });

    const own = await runWithPrincipal(ALICE, async () =>
      lifecycle.searchMessages('私密', 's-cache-1')
    );
    expect(own).toHaveLength(1);

    const other = await runWithPrincipal(BOB, async () =>
      lifecycle.searchMessages('私密', 's-cache-1')
    );
    expect(other).toEqual([]);
  });

  it('searchMessages：不指定 sessionId 时只聚合可访问会话', async () => {
    const search = (messages: unknown[]) => messages;
    const lifecycle = makeLifecycle(makeSessionWithMessages(), {
      searchMessages: search,
    });

    const own = await runWithPrincipal(ALICE, async () =>
      lifecycle.searchMessages('私密')
    );
    expect(own).toHaveLength(1);

    const other = await runWithPrincipal(BOB, async () =>
      lifecycle.searchMessages('私密')
    );
    expect(other).toEqual([]);
  });

  it('getSessions：本地恒见全部；已认证身份只见自己的会话', async () => {
    const aliceSession = makeSession({ tenantId: 'acme', userId: 'alice' });
    const bobSession = {
      ...makeSession({ tenantId: 'acme', userId: 'bob' }),
      id: 's-bob-1',
    } as ChatSession;
    const lifecycle = makeLifecycle([aliceSession, bobSession]);

    // 本地身份（桌面 / 后台）：零行为变更
    expect(
      lifecycle
        .getSessions()
        .map((s) => s.id)
        .sort()
    ).toEqual(['s-bob-1', 's-cache-1']);

    const aliceView = await runWithPrincipal(ALICE, async () =>
      lifecycle.getSessions()
    );
    expect(aliceView.map((s) => s.id)).toEqual(['s-cache-1']);

    const bobView = await runWithPrincipal(BOB, async () =>
      lifecycle.getSessions()
    );
    expect(bobView.map((s) => s.id)).toEqual(['s-bob-1']);
  });
});
