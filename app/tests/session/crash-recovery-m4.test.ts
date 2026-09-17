// MIT License
// Copyright (c) 2026 190615273@qq.com

// M4（2026-09-17）：优雅关闭写 metadata.cleanShutdown 标记 + 恢复流程跳过 + 重新激活清除
import { describe, it, expect } from 'bun:test';
import {
  CrashRecoveryManager,
  CLEAN_SHUTDOWN_MARKER,
  isCleanShutdown,
} from '../../src/session/recovery/CrashRecoveryManager';
import { SessionStatus } from '../../src/session/types/Session';
import type { UnifiedSessionStorage } from '../../src/session/storage/UnifiedStorage';
import type { UnifiedSession } from '../../src/session/types/Session';

/** 最小内存 storage mock（仅 CrashRecoveryManager 测试必需的方法，其余 never） */
function createFakeStorage(
  sessions: Map<string, UnifiedSession>
): UnifiedSessionStorage {
  const base: UnifiedSessionStorage = {
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
    async listSessions(
      _filter?: Parameters<UnifiedSessionStorage['listSessions']>[0]
    ) {
      return [...sessions.values()].map((s) => ({ ...s }));
    },
  } as unknown as UnifiedSessionStorage;
  return base;
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

describe('M4: cleanShutdown 优雅关闭标记', () => {
  it('markCleanShutdown 只标记可中断会话（ACTIVE/RUNNING 且确有活动），并写 metadata 标记', async () => {
    const now = Date.now();
    const sessions = new Map<string, UnifiedSession>();
    // 1) 可中断：ACTIVE + 确有活动
    sessions.set('active1', makeSession('active1', SessionStatus.ACTIVE, now - 1000, now - 2000));
    // 2) RUNNING + 有活动 → 也可中断
    sessions.set('running1', makeSession('running1', SessionStatus.RUNNING, now - 500, now - 2000));
    // 3) 已 PAUSED → 不参与
    sessions.set('paused1', makeSession('paused1', SessionStatus.PAUSED, now - 1000, now - 2000));
    // 4) ACTIVE 但空壳（lastActivityAt == createdAt）→ 跳过
    const shellCreated = now - 900;
    sessions.set(
      'shell1',
      makeSession('shell1', SessionStatus.ACTIVE, shellCreated, shellCreated)
    );
    const mgr = new CrashRecoveryManager({ storage: createFakeStorage(sessions) });

    const marked = await mgr.markCleanShutdown();

    expect(marked).toBe(2);
    expect(isCleanShutdown(sessions.get('active1')!)).toBe(true);
    expect(sessions.get('active1')!.metadata[CLEAN_SHUTDOWN_MARKER]).toBe(true);
    expect(isCleanShutdown(sessions.get('running1')!)).toBe(true);
    // 非可中断的未被标记
    expect(isCleanShutdown(sessions.get('paused1')!)).toBe(false);
    expect(isCleanShutdown(sessions.get('shell1')!)).toBe(false);
  });

  it('recoverAfterCrash 跳过 cleanShutdown 标记会话（不再批量转 PAUSED/ERROR）', async () => {
    const now = Date.now();
    const sessions = new Map<string, UnifiedSession>();
    // 已优雅关闭的可中断会话
    const cleaned = makeSession(
      'cleaned',
      SessionStatus.ACTIVE,
      now - 1000,
      now - 2000
    );
    cleaned.metadata = { ...cleaned.metadata, cleanShutdown: true };
    sessions.set('cleaned', cleaned);
    // 未标记的同状态会话 → 仍会被恢复（转 paused）
    sessions.set('crashed', makeSession('crashed', SessionStatus.RUNNING, now - 1000, now - 2000));
    const mgr = new CrashRecoveryManager({ storage: createFakeStorage(sessions) });

    const result = await mgr.recoverAfterCrash();

    // cleanShutdown 会话状态未被改动（仍 ACTIVE，非 paused/error）
    expect(sessions.get('cleaned')!.status).toBe(SessionStatus.ACTIVE);
    // 未标记会话照常被暂停
    expect(sessions.get('crashed')!.status).toBe(SessionStatus.PAUSED);
    expect(result.pausedSessions).toBe(1);
    expect(result.failedSessions).toBe(0);
  });

  it('resumeSession 清除 cleanShutdown 标记（真实活动开始后不得再跳过）', async () => {
    const now = Date.now();
    const sessions = new Map<string, UnifiedSession>();
    const s = makeSession('s', SessionStatus.PAUSED, now - 1000, now - 2000);
    s.metadata = { ...s.metadata, cleanShutdown: true };
    sessions.set('s', s);
    const mgr = new CrashRecoveryManager({ storage: createFakeStorage(sessions) });

    await mgr.resumeSession('s');

    const resumed = sessions.get('s')!;
    expect(resumed.status).toBe(SessionStatus.ACTIVE);
    expect(CLEAN_SHUTDOWN_MARKER in resumed.metadata).toBe(false);
    expect(isCleanShutdown(resumed)).toBe(false);
  });
});