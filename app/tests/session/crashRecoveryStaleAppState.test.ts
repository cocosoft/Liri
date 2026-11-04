// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2（2026-11-04，前端会话跟踪）：**stale 会话只标记自身，不把整个应用置 ERROR**。
 *
 * 实证：真机 `state:machine | 状态转换(关键): busy → error`，理由是
 * `会话崩溃恢复失败（stale）: session_mw26…`（上一进程遗留的探测会话）——
 * 一个过期会话把全局状态推到 error，前端整体呈错误态，与故障范围严重不匹配。
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { CrashRecoveryManager } from '../../src/session/recovery/CrashRecoveryManager';
import { SessionStatus } from '../../src/session/types/UnifiedSession';
import type { UnifiedSessionStorage } from '../../src/session/storage/UnifiedStorage';
import type { UnifiedSession } from '../../src/session/types/UnifiedSession';
import {
  getAppState,
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

describe('stale 会话的故障范围（P2）', () => {
  beforeEach(() => {
    initAppStateMachine(); // 复位上次运行遗留的 ERROR（若有）
    markAppIdle('test: baseline');
  });

  it('过期会话 ⇒ 仅该会话落 ERROR/failed_stale，应用状态不变', async () => {
    const now = Date.now();
    const sessions = new Map<string, UnifiedSession>();
    sessions.set(
      'stale-1',
      makeSession('stale-1', SessionStatus.ACTIVE, now - 600_000, now - 700_000)
    );
    const mgr = new CrashRecoveryManager({
      storage: createFakeStorage(sessions),
      staleThresholdMs: 60_000,
    });

    const before = getAppState();
    const detail = await mgr.recoverSingleSession('stale-1');

    expect(detail?.action).toBe('failed');
    const saved = sessions.get('stale-1');
    expect(saved?.status).toBe(SessionStatus.ERROR);
    expect(saved?.metadata?.crashRecovery).toBe('failed_stale');
    // 核心：单会话不可恢复**不得**改写应用全局状态
    expect(getAppState()).toBe(before);
    expect(getAppState()).not.toBe('error');
  });
});
