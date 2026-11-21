// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-21：**崩溃恢复的「在飞轮次」探针**回归锁。
 *
 * 实证（本机 61 个会话）：52 paused + 4 error，逐个核对 `events.jsonl` 后**最后一个 turn
 * 全部已闭合**（`terminationReason=completed` / `awaiting_approval`）。根因：`active` 的语义是
 * "可继续对话"（一轮正常结束后不改状态），而崩溃恢复把 ACTIVE 一律当成"上次崩溃时还在跑"。
 *
 * 契约：
 *   ① 探针说"已闭合" ⇒ 不动状态、不写 crashRecovery、不发 paused（旧行为下会批量标 paused）；
 *   ② 探针说"未闭合" ⇒ 仍走既有崩溃恢复（短空闲 paused / 超阈值 error）；
 *   ③ 探针抛错 ⇒ 保守按"可能中断"处理（不可漏掉真中断）；
 *   ④ 未注入探针 ⇒ 完全沿用旧口径（零行为变更）。
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { CrashRecoveryManager } from '@modules/session/recovery/CrashRecoveryManager';
import { SessionStatus } from '@modules/session/types/UnifiedSession';
import type { UnifiedSessionStorage } from '@modules/session/storage/UnifiedStorage';
import type { UnifiedSession } from '@modules/session/types/UnifiedSession';
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

describe('2026-11-21：崩溃恢复的在飞轮次探针', () => {
  beforeEach(() => {
    initAppStateMachine();
    markAppIdle('test: baseline');
  });

  it('轮次已闭合 ⇒ 不改状态、不写 crashRecovery、不计入恢复', async () => {
    const now = Date.now();
    const sessions = new Map<string, UnifiedSession>();
    sessions.set(
      'closed-turn',
      makeSession('closed-turn', SessionStatus.ACTIVE, now, now - 10_000)
    );
    const mgr = new CrashRecoveryManager({
      storage: createFakeStorage(sessions),
      staleThresholdMs: 30 * 60_000,
      isTurnOpen: async () => false,
    });

    const result = await mgr.recoverAfterCrash();

    const saved = sessions.get('closed-turn');
    expect(saved?.status).toBe(SessionStatus.ACTIVE);
    expect(saved?.metadata?.crashRecovery).toBeUndefined();
    expect(result.totalChecked).toBe(0);
    expect(result.pausedSessions).toBe(0);
    expect(result.failedSessions).toBe(0);
  });

  it('轮次未闭合（短空闲）⇒ paused（既有口径不变）', async () => {
    const now = Date.now();
    const sessions = new Map<string, UnifiedSession>();
    sessions.set(
      'open-turn',
      makeSession('open-turn', SessionStatus.ACTIVE, now, now - 10_000)
    );
    const mgr = new CrashRecoveryManager({
      storage: createFakeStorage(sessions),
      staleThresholdMs: 30 * 60_000,
      isTurnOpen: () => true,
    });

    const result = await mgr.recoverAfterCrash();

    const saved = sessions.get('open-turn');
    expect(saved?.status).toBe(SessionStatus.PAUSED);
    expect(saved?.metadata?.crashRecovery).toBe('recovered_paused');
    expect(result.pausedSessions).toBe(1);
  });

  it('轮次未闭合（超阈值）⇒ error（既有口径不变）', async () => {
    const now = Date.now();
    const sessions = new Map<string, UnifiedSession>();
    sessions.set(
      'open-turn-stale',
      makeSession(
        'open-turn-stale',
        SessionStatus.ACTIVE,
        now - 3_600_000,
        now - 7_200_000
      )
    );
    const mgr = new CrashRecoveryManager({
      storage: createFakeStorage(sessions),
      staleThresholdMs: 30 * 60_000,
      isTurnOpen: () => true,
    });

    const result = await mgr.recoverAfterCrash();

    const saved = sessions.get('open-turn-stale');
    expect(saved?.status).toBe(SessionStatus.ERROR);
    expect(saved?.metadata?.crashRecovery).toBe('failed_stale');
    expect(result.failedSessions).toBe(1);
  });

  it('探针抛错 ⇒ 保守按可能中断处理（paused）', async () => {
    const now = Date.now();
    const sessions = new Map<string, UnifiedSession>();
    sessions.set(
      'probe-error',
      makeSession('probe-error', SessionStatus.ACTIVE, now, now - 10_000)
    );
    const mgr = new CrashRecoveryManager({
      storage: createFakeStorage(sessions),
      staleThresholdMs: 30 * 60_000,
      isTurnOpen: () => {
        throw new Error('events.jsonl 读取失败');
      },
    });

    await mgr.recoverAfterCrash();

    expect(sessions.get('probe-error')?.status).toBe(SessionStatus.PAUSED);
    expect(sessions.get('probe-error')?.metadata?.crashRecovery).toBe(
      'recovered_paused'
    );
  });

  it('未注入探针 ⇒ 沿用旧口径（ACTIVE+有活动 ⇒ paused）', async () => {
    const now = Date.now();
    const sessions = new Map<string, UnifiedSession>();
    sessions.set(
      'legacy',
      makeSession('legacy', SessionStatus.ACTIVE, now, now - 10_000)
    );
    const mgr = new CrashRecoveryManager({
      storage: createFakeStorage(sessions),
      staleThresholdMs: 30 * 60_000,
    });

    await mgr.recoverAfterCrash();

    expect(sessions.get('legacy')?.status).toBe(SessionStatus.PAUSED);
  });

  it('setTurnOpenProbe 可在构造后替换（宿主的接线方式）', async () => {
    const now = Date.now();
    const sessions = new Map<string, UnifiedSession>();
    sessions.set(
      'late-probe',
      makeSession('late-probe', SessionStatus.ACTIVE, now, now - 10_000)
    );
    const mgr = new CrashRecoveryManager({
      storage: createFakeStorage(sessions),
    });
    mgr.setTurnOpenProbe(async () => false);

    await mgr.recoverAfterCrash();

    expect(sessions.get('late-probe')?.status).toBe(SessionStatus.ACTIVE);
  });
});
