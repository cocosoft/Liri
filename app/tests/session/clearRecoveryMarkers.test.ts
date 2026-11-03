/**
 * 2026-11-03 实时巡检：清除崩溃恢复遗留标记
 *
 * 现场：启动期被判 `failed_stale` 的会话（`ERROR` + `crashRecovery/crashedAt`）后来被
 * AlwaysOn 重新跑起来，但没人清标记 ⇒ 前端长期显示"失败/崩溃"，事件流却仍在产出。
 *
 * 口径：只清恢复期字段；仅当标记是 `failed_stale` 且状态仍是 ERROR 时才复位 ACTIVE
 *（真实业务失败不得被抹掉）；无标记不写盘。
 */
import { describe, it, expect } from 'bun:test';

import { clearStaleRecoveryMarkers } from '../../src/session/recovery/CrashRecoveryManager';
import { SessionStatus } from '../../src/session/types/UnifiedSession';
import type { UnifiedSessionStorage } from '../../src/session/storage/UnifiedStorage';
import type { UnifiedSession } from '../../src/session/types/UnifiedSession';

function createFakeStorage(
  sessions: Map<string, UnifiedSession>
): UnifiedSessionStorage & { updates: number } {
  const base = {
    updates: 0,
    async createSession(s: UnifiedSession) {
      sessions.set(s.id, s);
      return s.id;
    },
    async getSession(id: string) {
      return sessions.get(id) ?? null;
    },
    async updateSession(s: UnifiedSession) {
      base.updates += 1;
      sessions.set(s.id, s);
    },
    async listSessions() {
      return [...sessions.values()].map((s) => ({ ...s }));
    },
  };
  return base as unknown as UnifiedSessionStorage & { updates: number };
}

function makeSession(
  id: string,
  status: SessionStatus,
  metadata: Record<string, unknown> = {}
): UnifiedSession {
  const now = Date.now();
  return {
    id,
    type: 'local' as never,
    title: id,
    createdAt: now - 1000,
    updatedAt: now,
    lastActivityAt: now,
    status,
    metadata,
  } as UnifiedSession;
}

describe('clearRecoveryMarkers（2026-11-03）', () => {
  it('failed_stale + ERROR ⇒ 清三个恢复字段并复位 ACTIVE', async () => {
    const sessions = new Map<string, UnifiedSession>();
    sessions.set(
      'stale',
      makeSession('stale', SessionStatus.ERROR, {
        crashRecovery: 'failed_stale',
        crashedAt: '1793661020774',
        lastActivityBeforeCrash: '1793646746166',
        keep: 'me',
      })
    );
    const storage = createFakeStorage(sessions);

    const cleared = await clearStaleRecoveryMarkers(storage, 'stale');

    expect(cleared).toBe(true);
    const after = sessions.get('stale')!;
    expect(after.status).toBe(SessionStatus.ACTIVE);
    expect(after.metadata.crashRecovery).toBeUndefined();
    expect(after.metadata.crashedAt).toBeUndefined();
    expect(after.metadata.lastActivityBeforeCrash).toBeUndefined();
    // 其它 metadata 不受影响
    expect((after.metadata as Record<string, unknown>).keep).toBe('me');
  });

  it('无标记 ⇒ 不写盘（零 IO）', async () => {
    const sessions = new Map<string, UnifiedSession>();
    sessions.set('plain', makeSession('plain', SessionStatus.ACTIVE));
    const storage = createFakeStorage(sessions);

    expect(await clearStaleRecoveryMarkers(storage, 'plain')).toBe(false);
    expect(storage.updates).toBe(0);
  });

  it('标记不是 failed_stale ⇒ 只清字段，不动状态（真实失败不被抹掉）', async () => {
    const sessions = new Map<string, UnifiedSession>();
    sessions.set(
      'paused',
      makeSession('paused', SessionStatus.ERROR, {
        crashRecovery: 'recovered_paused',
        crashedAt: '1',
      })
    );
    const storage = createFakeStorage(sessions);

    expect(await clearStaleRecoveryMarkers(storage, 'paused')).toBe(true);
    expect(sessions.get('paused')!.status).toBe(SessionStatus.ERROR);
    expect(sessions.get('paused')!.metadata.crashRecovery).toBeUndefined();
  });

  it('会话不存在 ⇒ false', async () => {
    const storage = createFakeStorage(new Map());
    expect(await clearStaleRecoveryMarkers(storage, 'missing')).toBe(false);
  });
});
