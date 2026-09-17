// MIT License
// Copyright (c) 2026 190615273@qq.com
// H7 回归测试（2026-09-17）：
//   count 剪枝基数改为 nonActive（与 getPruneEstimate 预估一致）——活跃会话不因
//   count 超限被误删；preservedIds 按磁盘实况（listSessions 全量 id）计算——
//   loadSession 失败的会话也计入 preserved，保证 deleted + preserved === 磁盘会话总数。

import { describe, expect, it } from 'bun:test';
// 必须先求值 SessionManager：SessionPruner → @modules/error → ... → plugins/index.ts
// 顶层动态 import PluginManager → SessionManager → 构造内 new SessionPruner()，
// 若 SessionPruner 仍处于求值中（TDZ）会崩溃。先 import SessionManager 使其完整
// 求值（含其 hoisted 的 SessionPruner import），后续引用即安全。
// TODO: CS05-ROOTFIX — 根因是 SessionManager.ts 顶层 `new SessionManager()` 副作用，
// 懒加载单例后本 workaround 可移除。
import '../../src/session/SessionManager';
import { SessionPruner } from '../../src/session/SessionPruner';
import type { SessionStorage } from '../../src/session/SessionStorage';
import type { Session } from '../../src/session/models/Session';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function mockSession(id: string, updatedAt: number): Session {
  return { id, updatedAt: new Date(updatedAt) } as unknown as Session;
}

/** 内存版 SessionStorage（loadSession 可返回 null 模拟磁盘脏项） */
class MemoryPrunerStorage implements SessionStorage {
  private sessions = new Map<string, Session>();
  /** loadSession 返回 null 的 id（模拟磁盘上损坏/缺失但仍在列表中的会话） */
  private missing = new Set<string>();

  listSessions(): Promise<string[]> {
    return Promise.resolve([
      ...this.sessions.keys(),
      ...this.missing,
    ]);
  }
  loadSession(sessionId: string): Promise<Session | null> {
    if (this.missing.has(sessionId)) return Promise.resolve(null);
    return Promise.resolve(this.sessions.get(sessionId) ?? null);
  }
  deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    return Promise.resolve();
  }

  put(s: Session): void {
    this.sessions.set(s.id, s);
  }
  markMissing(id: string): void {
    this.missing.add(id);
  }
  listIds(): string[] {
    return [...this.sessions.keys()];
  }

  // 未使用的接口
  saveSession = async (): Promise<void> => {};
  saveMessage = async (): Promise<void> => {};
  loadMessages = async (): Promise<never[]> => [];
  saveMetadata = async (): Promise<void> => {};
  loadMetadata = async (): Promise<null> => null;
  sessionExists = async (): Promise<boolean> => false;
  compactSession = async (): Promise<void> => {};
}

describe('H7: count 剪枝基数 nonActive——活跃会话不被误删', () => {
  it('活跃会话数超 maxSessions 时仍保留（只剪非活跃超限部分）', async () => {
    const now = Date.now();
    const storage = new MemoryPrunerStorage();
    // 3 个非活跃（10 天前，仍在 maxAgeDays 内，避免 age 干扰）+ 5 个活跃（最近）
    // → 总数 8 > maxSessions=2，但只按非活跃基数剪
    for (let i = 0; i < 3; i++) {
      storage.put(mockSession(`old-${i}`, now - 10 * DAY));
    }
    for (let i = 0; i < 5; i++) {
      storage.put(mockSession(`active-${i}`, now - 30 * 60 * 1000)); // 30min 前，缓冲区内
    }
    const pruner = new SessionPruner(storage, { maxSessions: 2, maxAgeDays: 30 });

    // 预估与实际一致：countCandidates = 非活跃数 3 - maxSessions 2 = 1
    const estimate = await pruner.getPruneEstimate();
    expect(estimate.countCandidates).toBe(1);

    const result = await pruner.prune();

    // 只剪 1 个最旧非活跃（3 - 2），活跃会话全部保留
    expect(result.reason).toBe('count');
    expect(result.deletedCount).toBe(1);
    expect(result.deletedIds).toEqual(['old-0']);
    // 活跃会话一个不少
    for (let i = 0; i < 5; i++) {
      expect(storage.listIds()).toContain(`active-${i}`);
    }
    // 非活跃只剪超限部分：old-1/old-2 仍保留
    expect(storage.listIds()).toContain('old-1');
    expect(storage.listIds()).toContain('old-2');
  });
});

describe('H7: preservedIds 按磁盘实况——deleted + preserved = 磁盘总数', () => {
  it('loadSession 返回 null 的会话仍计入 preserved（不产生差值）', async () => {
    const now = Date.now();
    const storage = new MemoryPrunerStorage();
    // 磁盘列表 3 个 id：1 个 loadSession 返回 null（脏项）、2 个可正常加载
    storage.markMissing('ghost');
    storage.put(mockSession('a', now - 10 * DAY));
    storage.put(mockSession('b', now - 20 * DAY));
    // maxAgeDays/maxSessions 放大 → 本用例只验证 preservedIds 的磁盘实况基数
    const pruner = new SessionPruner(storage, {
      maxSessions: 10,
      maxAgeDays: 1000,
    });

    const result = await pruner.prune();

    // 磁盘实况总数 = 3；ghost 不算 deleted，必须在 preserved 里
    expect(result.deletedCount + result.preservedCount).toBe(3);
    expect(result.deletedCount).toBe(0);
    expect(result.preservedIds).toContain('ghost');
    // 旧实现按 sessionsWithTime 计算 preserved（仅 2 个 load 成功的）→ 会丢 ghost
    expect(result.preservedIds).toEqual(
      expect.arrayContaining(['a', 'b', 'ghost'])
    );
  });
});

describe('H7: age 剪枝只删超龄会话', () => {
  it('未超龄（含活跃）会话不因 age 被剪', async () => {
    const now = Date.now();
    const storage = new MemoryPrunerStorage();
    storage.put(mockSession('old', now - 30 * DAY));
    storage.put(mockSession('recent', now - 10 * DAY));
    storage.put(mockSession('active', now - 5 * HOUR)); // 活跃（60min 缓冲区内）
    const pruner = new SessionPruner(storage, { maxAgeDays: 15, maxSessions: 100 });

    const result = await pruner.prune();

    expect(result.reason).toBe('age');
    expect(result.deletedIds).toEqual(['old']);
    expect(result.preservedIds).toEqual(
      expect.arrayContaining(['recent', 'active'])
    );
  });
});
