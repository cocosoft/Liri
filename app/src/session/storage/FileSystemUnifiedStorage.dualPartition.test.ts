/**
 * P0'（2026-09-18）双分区聚合单测：
 * - 兼容读多分区（basePath + legacyRoots）会话聚合
 * - 同 id 跨分区冲突按 updatedAt 取新（新写入的分区版本胜出）
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
// 复刻生产入口（main.ts）顺序：先求值 @modules/core barrel（其链路会按序完成
// session 存储注册），避免"StorageFactory → error → monitoring → core → session
// → MemoryUnifiedStorage → StorageFactory"循环 TDZ
import '@modules/core';
import { FileSystemUnifiedStorage } from './FileSystemUnifiedStorage';
import { StorageType } from './UnifiedStorage';
import type { UnifiedSession } from '../types/UnifiedSession';

function makeSession(id: string, updatedAt: number): UnifiedSession {
  return {
    id,
    type: 'chat' as never,
    title: `会话-${id}`,
    createdAt: updatedAt - 3600000,
    updatedAt,
    lastActivityAt: updatedAt,
    status: 'active' as never,
    metadata: {},
  };
}

function writeSessionJson(root: string, session: UnifiedSession): void {
  const dir = join(root, session.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'session.json'), JSON.stringify(session), 'utf-8');
}

function createStorage(
  basePath: string,
  legacyRoots: string[]
): FileSystemUnifiedStorage {
  return new FileSystemUnifiedStorage({
    type: StorageType.FILESYSTEM,
    basePath,
    legacyRoots,
  });
}

describe("FileSystemUnifiedStorage 双分区聚合（P0'）", () => {
  let rootA: string;
  let rootB: string;

  beforeEach(() => {
    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    rootA = join(tmpdir(), `p0p-a-${tag}`);
    rootB = join(tmpdir(), `p0p-b-${tag}`);
    mkdirSync(rootA, { recursive: true });
    mkdirSync(rootB, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  });

  it('跨分区不同 id 会话全部聚合', async () => {
    writeSessionJson(rootA, makeSession('session_a', 2000));
    writeSessionJson(rootB, makeSession('session_b', 3000));
    const storage = createStorage(rootA, [rootB]);
    await storage.initialize();
    const sessions = await storage.listSessions();
    const ids = sessions.map((s) => s.id).sort();
    expect(ids).toEqual(['session_a', 'session_b']);
    await storage.close();
  });

  it('同 id 跨分区冲突按 updatedAt 取新（legacy 分区更新 → 覆盖当前分区）', async () => {
    writeSessionJson(rootA, makeSession('session_dup', 2000)); // current 旧
    writeSessionJson(rootB, makeSession('session_dup', 4000)); // legacy 新
    const storage = createStorage(rootA, [rootB]);
    await storage.initialize();
    const sessions = await storage.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('session_dup');
    expect(sessions[0].updatedAt).toBe(4000);
    await storage.close();
  });

  it('同 id 跨分区冲突按 updatedAt 取新（当前分区更新 → 保留当前分区）', async () => {
    writeSessionJson(rootA, makeSession('session_dup', 5000)); // current 新
    writeSessionJson(rootB, makeSession('session_dup', 3000)); // legacy 旧
    const storage = createStorage(rootA, [rootB]);
    await storage.initialize();
    const sessions = await storage.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].updatedAt).toBe(5000);
    await storage.close();
  });

  it('不存在的 legacyRoots 不报错（ENOENT 静默跳过）', async () => {
    writeSessionJson(rootA, makeSession('session_a', 1000));
    const missingRoot = join(tmpdir(), `p0p-missing-${Date.now()}`);
    const storage = createStorage(rootA, [missingRoot]);
    await storage.initialize();
    const sessions = await storage.listSessions();
    expect(sessions.map((s) => s.id)).toEqual(['session_a']);
    await storage.close();
    rmSync(missingRoot, { recursive: true, force: true });
  });
});
