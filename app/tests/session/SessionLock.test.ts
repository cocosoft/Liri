// MIT License
// Copyright (c) 2026 190615273@qq.com
// SessionLock H4 回归测试（2026-09-17）：
//   - releaseStale 改为 compare-and-delete（读回校验 holder + acquiredAt 未变再 unlink）
//   - isLocked / getCurrentHolder 去写副作用（纯查询，stale 清理权归 acquire 独占）
//   - release / renew 的 compare-and-delete 守卫（P1-fix H5，与 H4 同语义）

import { describe, expect, it, afterEach } from 'bun:test';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SessionLock } from '../../src/session/SessionLock';

const lockDirs: string[] = [];
afterEach(() => {
  while (lockDirs.length > 0) {
    const dir = lockDirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言
    }
  }
});

function makeLockDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lock-h4-'));
  lockDirs.push(dir);
  return dir;
}

function writeLock(
  dir: string,
  sessionId: string,
  holder: string,
  acquiredAt: number
): string {
  const p = join(dir, `${sessionId}.lock`);
  writeFileSync(p, JSON.stringify({ holder, acquiredAt }), 'utf-8');
  return p;
}

function readLock(dir: string, sessionId: string): {
  holder: string;
  acquiredAt: number;
} | null {
  const p = join(dir, `${sessionId}.lock`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8'));
}

describe('H4: isLocked / getCurrentHolder 纯查询无 unlink 写副作用', () => {
  it('stale 锁文件仍被读为占用，查询后文件不被删除（清理权归 acquire）', async () => {
    const dir = makeLockDir();
    const p = writeLock(dir, 's1', 'holder-x', Date.now() - 120000);

    const lock = new SessionLock({ lockDir: dir });

    expect(await lock.isLocked('s1')).toBe(true);
    expect(await lock.getCurrentHolder('s1')).toBe('holder-x');
    // 纯查询：两次调用后锁文件必须仍在（旧实现 isLocked 会 unlink stale 文件）
    expect(existsSync(p)).toBe(true);
  });
});

describe('H4: releaseStale compare-and-delete（acquire 独占清理权）', () => {
  it('锁文件未被改动 → acquire 强拆 stale 锁并成功获取', async () => {
    const dir = makeLockDir();
    writeLock(dir, 's2', 'old-holder', Date.now() - 120000);

    const lock = new SessionLock({
      lockDir: dir,
      staleThreshold: 60000,
      timeout: 2000,
      retryInterval: 10,
    });

    const res = await lock.acquire('s2');
    expect(res.success).toBe(true);
    // stale 锁已按 compare-and-delete 移除并重建为新持有者
    const current = readLock(dir, 's2');
    expect(current?.holder).toBe(res.holder);
  });

  it('锁文件已被他方重建 → release 不误删新锁（双持有者防护）', async () => {
    const dir = makeLockDir();
    const lock = new SessionLock({ lockDir: dir });
    const res = await lock.acquire('s3');
    expect(res.success).toBe(true);

    // 模拟外部进程强拆并重建锁（新持有者）
    writeLock(dir, 's3', 'new-holder', Date.now());

    await lock.release('s3');
    // 新持有者的锁文件必须仍在（旧实现直接 unlink 会误删新锁 → 双持有者并发写）
    const current = readLock(dir, 's3');
    expect(current?.holder).toBe('new-holder');
  });
});
