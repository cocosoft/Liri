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
import { DataSessionStatus } from '../../src/core';
import type { Principal } from '../../src/core/identity/principal';
import { runWithPrincipal } from '../../src/core/identity/requestScope';
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
function makeLifecycle(session: ChatSession): SessionLifecycleManager {
  return new SessionLifecycleManager({
    chatSessions: new Map([[session.id, session]]),
    currentSessionIdRef: { get: () => null, set: () => {} },
    sessionLeaveTimes: new Map(),
    sessionMutexes: new Map(),
    sessionAbortControllers: new Map(),
    sessionGateway: {} as unknown as SessionGateway,
    sessionAccess: {} as unknown as SessionAccessFacade,
    hookChainManager: {} as unknown as HookChainManager,
    messageService: {} as unknown as MessageService,
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
