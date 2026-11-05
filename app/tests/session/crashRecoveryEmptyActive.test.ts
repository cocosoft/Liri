// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P0-2（2026-11-05）：**空壳会话状态对账**回归锁。
 *
 * 实证：`session_mvzzaaux97c95991e0`「对话 1」→ `status=active`、`messageCount=0`、
 * `roundCount=0`，且跨 daemon 重启仍为 active。根因是崩溃恢复对
 * 「从未有活动（`lastActivityAt <= createdAt`）」的会话直接跳过（本意是别批量转
 * paused/error），于是 ACTIVE 空壳被永久保留为「运行中」。
 *
 * 契约：
 *   ① ACTIVE 且从未有活动 ⇒ 对账为 PAUSED（不写 crashRecovery 元数据，不算崩溃恢复）；
 *   ② ACTIVE 且有活动 ⇒ 仍走既有崩溃恢复（recovered_paused）；
 *   ③ 非 ACTIVE 的空壳 ⇒ 一律不动。
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { CrashRecoveryManager } from '../../src/session/recovery/CrashRecoveryManager';
import { SessionStatus } from '../../src/session/types/UnifiedSession';
import type { UnifiedSessionStorage } from '../../src/session/storage/UnifiedStorage';
import type { UnifiedSession } from '../../src/session/types/UnifiedSession';
import {
  initAppStateMachine,
  markAppIdle,
} from '@openliri/infra/state/app/AppLifecycle';

function createFakeStorage(
  sessions: Map<string, UnifiedSession>
): UnifiedSessionStorage {
  return {
    async createSession(s: UnifiedSession) {
      sessions.set(s.id, s);
      return s.id;
    },
    async getSession(id: string) {
      return sessions.get(id) ?? null;
    },
    async updateSession(s: UnifiedSession) {
      sessions.set(s.id, s);
    },
    async listSessions() {
      return [...sessions.values()].map((s) => ({ ...s }));
    },
  } as unknown as UnifiedSessionStorage;
}

function makeSession(
  id: string,
  status: SessionStatus,
  lastActivityAt: number,
  createdAt = 1000
): UnifiedSession {
  return {
    id,
    type: 'local' as never,
    title: id,
    createdAt,
    updatedAt: lastActivityAt,
    lastActivityAt,
    status,
    metadata: {},
  } as UnifiedSession;
}

describe('P0-2：空壳会话状态对账', () => {
  beforeEach(() => {
    initAppStateMachine();
    markAppIdle('test: baseline');
  });

  it('ACTIVE 且从未有活动 ⇒ 对账为 PAUSED（不写 crashRecovery）', async () => {
    const sessions = new Map<string, UnifiedSession>();
    sessions.set(
      'empty-active',
      makeSession('empty-active', SessionStatus.ACTIVE, 1000, 1000)
    );
    const mgr = new CrashRecoveryManager({
      storage: createFakeStorage(sessions),
    });

    const result = await mgr.recoverAfterCrash();

    const saved = sessions.get('empty-active');
    expect(saved?.status).toBe(SessionStatus.PAUSED);
    expect(saved?.metadata?.statusReconcile).toBe('empty_active');
    expect(saved?.metadata?.crashRecovery).toBeUndefined();
    expect(result.skippedSessions).toBe(1);
    expect(result.totalChecked).toBe(0);
  });

  it('ACTIVE 且有活动 ⇒ 仍走崩溃恢复（不被对账逻辑截走）', async () => {
    const now = Date.now();
    const sessions = new Map<string, UnifiedSession>();
    sessions.set(
      'used-active',
      makeSession('used-active', SessionStatus.ACTIVE, now, now - 10_000)
    );
    const mgr = new CrashRecoveryManager({
      storage: createFakeStorage(sessions),
      staleThresholdMs: 30 * 60_000,
    });

    const result = await mgr.recoverAfterCrash();

    const saved = sessions.get('used-active');
    expect(saved?.status).toBe(SessionStatus.PAUSED);
    expect(saved?.metadata?.crashRecovery).toBe('recovered_paused');
    expect(saved?.metadata?.statusReconcile).toBeUndefined();
    expect(result.totalChecked).toBe(1);
  });

  it('非 ACTIVE 的空壳 ⇒ 不动', async () => {
    const sessions = new Map<string, UnifiedSession>();
    sessions.set(
      'paused-empty',
      makeSession('paused-empty', SessionStatus.PAUSED, 1000, 1000)
    );
    const mgr = new CrashRecoveryManager({
      storage: createFakeStorage(sessions),
    });

    await mgr.recoverAfterCrash();

    const saved = sessions.get('paused-empty');
    expect(saved?.status).toBe(SessionStatus.PAUSED);
    expect(saved?.metadata?.statusReconcile).toBeUndefined();
  });
});
