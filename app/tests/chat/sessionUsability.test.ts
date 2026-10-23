/**
 * 多租户 P3：`canUseSession` —— HTTP 入口 404 语义的唯一判据
 *
 * 锁四件事：
 *  ① 本地身份也**要求确实存在**（BUG-14：不再豁免存在性；归属判定恒放行）；
 *  ② 已认证身份：内存缓存里是**自己的** ⇒ 可用；是**别人的** ⇒ 不可用；
 *  ③ 缓存未命中时看按身份分区的存储：存储里没有 ⇒ 不可用；有但归属不符 ⇒ 不可用；
 *  ④ 存储读取抛错 ⇒ 不可用（fail-closed）。
 */
import { describe, expect, it } from 'bun:test';

import type { ChatSession } from '../../src/session/types/session';
import { DataSessionStatus } from '@openliri/kernel';
import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope';
import { SessionLifecycleManager } from '../../src/chat/services/SessionLifecycleManager';
import type { SessionGateway } from '../../src/session/SessionGateway';
import type { SessionAccessFacade } from '../../src/chat/services/SessionAccessFacade';
import type { HookChainManager } from '../../src/hooks';
import type { MessageService } from '../../src/chat/services/MessageService';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

function makeSession(id: string, owner?: Principal): ChatSession {
  return {
    id,
    title: 'demo',
    state: DataSessionStatus.ACTIVE,
    metadata: owner
      ? {
          title: 'demo',
          owner: { tenantId: owner.tenantId, userId: owner.userId },
        }
      : { title: 'demo' },
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as ChatSession;
}

/** `stored`：模拟按身份分区的存储（只放当前身份可见的会话） */
function makeLifecycle(
  cached: ChatSession[],
  stored?: Record<string, ChatSession> | Error
): SessionLifecycleManager {
  return new SessionLifecycleManager({
    chatSessions: new Map(cached.map((s) => [s.id, s])),
    currentSessionIdRef: { get: () => null, set: () => {} },
    sessionLeaveTimes: new Map(),
    sessionMutexes: new Map(),
    sessionAbortControllers: new Map(),
    sessionGateway: {
      getSession: async (id: string) => {
        if (stored instanceof Error) throw stored;
        return stored?.[id] ?? null;
      },
    } as unknown as SessionGateway,
    sessionAccess: {} as unknown as SessionAccessFacade,
    hookChainManager: {} as unknown as HookChainManager,
    messageService: {} as unknown as MessageService,
  });
}

describe('canUseSession（P3）', () => {
  it('本地身份：存在才可用（BUG-14：不再豁免存在性）', async () => {
    // 缓存命中 ⇒ 可用（本地身份的归属判定恒放行）
    const cached = makeLifecycle([makeSession('s-local')]);
    expect(await cached.canUseSession('s-local')).toBe(true);

    // 缓存未命中但存储在 ⇒ 可用
    const inStore = makeLifecycle([], { 's-stored': makeSession('s-stored') });
    expect(await inStore.canUseSession('s-stored')).toBe(true);

    // 缓存与存储都没有 ⇒ 不可用（此前恒 true ⇒ 不存在的 id 被静默建造成新会话）
    const missing = makeLifecycle([], {});
    expect(await missing.canUseSession('any-id')).toBe(false);
  });

  it('内存缓存：自己的可用，别人的不可用', async () => {
    const lifecycle = makeLifecycle([
      makeSession('s-alice', ALICE),
      makeSession('s-local'),
    ]);

    expect(
      await runWithPrincipal(ALICE, () => lifecycle.canUseSession('s-alice'))
    ).toBe(true);
    expect(
      await runWithPrincipal(BOB, () => lifecycle.canUseSession('s-alice'))
    ).toBe(false);
    // 无归属的本地会话：远端身份不得使用
    expect(
      await runWithPrincipal(ALICE, () => lifecycle.canUseSession('s-local'))
    ).toBe(false);
  });

  it('缓存未命中：看按身份分区的存储（不存在 / 归属不符 / 归属相符）', async () => {
    const stored = makeSession('s-stored', ALICE);
    const lifecycle = makeLifecycle([], { 's-stored': stored });

    expect(
      await runWithPrincipal(ALICE, () => lifecycle.canUseSession('s-stored'))
    ).toBe(true);
    // 存储按身份分区 ⇒ 对 BOB 而言这个 id 根本查不到
    const bobView = makeLifecycle([], {});
    expect(
      await runWithPrincipal(BOB, () => bobView.canUseSession('s-stored'))
    ).toBe(false);
  });

  it('存储读取抛错 ⇒ 不可用（fail-closed）', async () => {
    const lifecycle = makeLifecycle([], new Error('gateway down'));
    expect(
      await runWithPrincipal(ALICE, () => lifecycle.canUseSession('s-1'))
    ).toBe(false);
  });
});
