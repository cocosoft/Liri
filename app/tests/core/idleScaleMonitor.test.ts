// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * IdleScaleMonitor 空闲降载测试（2026-09-02，P3-5 对标 Hermes scale_to_zero）
 *
 * 验证：空闲判定（无活跃工作 + 无 inbound 超时 → onIdle）、活跃工作阻止触发、
 * poke 复位、cleanupStaleTempFiles 只清过期文件。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  setUserDataDirOverride,
  getUserDataDirOverride,
  resolveTempDir,
} from '../../src/core/paths';
import {
  IdleScaleMonitor,
  cleanupStaleTempFiles,
} from '../../src/core/idle/IdleScaleMonitor';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('IdleScaleMonitor', () => {
  let baseDir: string;
  const prevOverride = getUserDataDirOverride();
  let activeCount = 0;
  let firedSeconds: number | null = null;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'idle-scale-test-'));
    setUserDataDirOverride(baseDir);
    activeCount = 0;
    firedSeconds = null;
  });

  afterEach(() => {
    setUserDataDirOverride(prevOverride);
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('无活跃工作且超时 → 触发 onIdle', async () => {
    const monitor = new IdleScaleMonitor({
      idleTimeoutMs: 100,
      pollMs: 30,
      activeWorkCount: () => activeCount,
      onIdle: (sec) => {
        firedSeconds = sec;
      },
    });
    monitor.start();
    await sleep(200);
    monitor.stop();
    expect(firedSeconds).not.toBeNull();
    expect(monitor.isIdle()).toBe(true);
  });

  it('活跃工作阻止空闲触发', async () => {
    const monitor = new IdleScaleMonitor({
      idleTimeoutMs: 100,
      pollMs: 30,
      activeWorkCount: () => activeCount,
      onIdle: (sec) => {
        firedSeconds = sec;
      },
    });
    activeCount = 1; // 有进行中的会话流
    monitor.start();
    await sleep(200);
    monitor.stop();
    expect(firedSeconds).toBeNull();
    expect(monitor.isIdle()).toBe(false);
  });

  it('poke 复位空闲计时', async () => {
    const monitor = new IdleScaleMonitor({
      idleTimeoutMs: 100,
      pollMs: 30,
      activeWorkCount: () => activeCount,
      onIdle: (sec) => {
        firedSeconds = sec;
      },
    });
    monitor.start();
    await sleep(60);
    monitor.poke(); // inbound 活动
    await sleep(60); // poke 后 60ms < 100ms
    expect(firedSeconds).toBeNull();
    await sleep(80); // 累计 140ms > 100ms
    monitor.stop();
    expect(firedSeconds).not.toBeNull();
  });
});

describe('cleanupStaleTempFiles', () => {
  let baseDir: string;
  const prevOverride = getUserDataDirOverride();

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'idle-temp-test-'));
    setUserDataDirOverride(baseDir);
  });

  afterEach(() => {
    setUserDataDirOverride(prevOverride);
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('只删除过期文件，保留新文件', async () => {
    const tempDir = resolveTempDir();
    mkdirSync(tempDir, { recursive: true });
    const stale = join(tempDir, 'stale.tmp');
    const fresh = join(tempDir, 'fresh.tmp');
    writeFileSync(stale, 'old');
    writeFileSync(fresh, 'new');
    // 旧文件 mtime 设为 25 小时前（超过默认 24h 阈值）
    const past = new Date(Date.now() - 25 * 3600_000);
    utimesSync(stale, past, past);

    const removed = await cleanupStaleTempFiles();
    expect(removed).toBe(1);
  });

  it('temp 目录不存在时安全返回 0', async () => {
    const removed = await cleanupStaleTempFiles();
    expect(removed).toBe(0);
  });
});
