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
 * **自唤醒「重启后恢复」回归**（R15 / 台账 L-13 / `.trae/specs/selfwake-restart-recovery.md`）。
 *
 * 缺陷（修复前实测）：`WakeStore.wakeToSession` 仅由 `save()` 填充 ⇒ **重启后为空**
 * ⇒ `fire()` 反查失败、`markFired()` 空操作 ⇒ 到期唤醒**不续跑且不落 `fired`**。
 *
 * 本组用**全新实例**模拟进程重启（磁盘上预置一条已到期的 `pending`），断言：
 *   R1 重启后 `fire` ⇒ **落 `fired`** 且续跑执行器**被调用一次**；
 *   R2 **幂等**：同一 `wakeId` 连续 `fire` 两次 ⇒ 续跑**仅一次**；
 *   R3 未知 `wakeId` ⇒ 不触发执行器（重建索引后仍未知）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// 覆盖数据目录，避免污染真实数据（与既有 SelfWakeFire.test.ts 同法）
const testDataDir = join(tmpdir(), `cg3-selfwake-restart-${randomUUID()}.d`);
process.env.PYAPP_DATA_DIR = testDataDir;

const { WakeStore } = await import('../../../src/tasks/selfwake/WakeStore');
const { SelfWakeService, setSelfWakeResumeHandler } =
  await import('../../../src/tasks/selfwake/SelfWakeService');

/** 写一条"上个进程已持久化"的到期 `pending` 条目（模拟重启前的磁盘状态） */
function seedPendingWake(sessionId: string, wakeId: string): void {
  const dir = join(testDataDir, 'selfwake');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${sessionId}.json`),
    JSON.stringify([
      {
        id: wakeId,
        kind: 'timer',
        status: 'pending',
        sessionId,
        taskId: 'task-restart',
        triggerAt: Date.now() - 1000,
        createdAt: Date.now() - 2000,
      },
    ])
  );
}

describe('SelfWakeService 重启后恢复（L-13）', () => {
  beforeEach(() => {
    if (!existsSync(testDataDir)) mkdirSync(testDataDir, { recursive: true });
    setSelfWakeResumeHandler(null);
  });

  afterEach(() => {
    setSelfWakeResumeHandler(null);
    try {
      if (existsSync(testDataDir))
        rmSync(testDataDir, { recursive: true, force: true });
    } catch {
      // @ignore-catch — 清理临时目录失败不影响断言
    }
  });

  it('R1 重启后 fire ⇒ 落 fired 且续跑一次（回归：修复前 status 仍 pending）', async () => {
    const sessionId = 'restart-s1';
    const wakeId = 'wake-restart-1';
    seedPendingWake(sessionId, wakeId);

    // 全新实例 = 进程重启（内存索引为空）
    const service = new SelfWakeService(new WakeStore(), 300_000);
    let calls = 0;
    setSelfWakeResumeHandler(async () => {
      calls++;
      return { ok: true };
    });

    await service.fire(wakeId);

    expect(calls).toBe(1);
    const reloaded = await new WakeStore().load(sessionId);
    expect(reloaded.find((e) => e.id === wakeId)?.status).toBe('fired');
    service.destroy();
  });

  it('R2 幂等：同一 wakeId 连续 fire 两次 ⇒ 续跑仅一次', async () => {
    const sessionId = 'restart-s2';
    const wakeId = 'wake-restart-2';
    seedPendingWake(sessionId, wakeId);

    const service = new SelfWakeService(new WakeStore(), 300_000);
    let calls = 0;
    setSelfWakeResumeHandler(async () => {
      calls++;
      return { ok: true };
    });

    await service.fire(wakeId);
    await service.fire(wakeId);

    expect(calls).toBe(1);
    const reloaded = new WakeStore();
    const entries = await reloaded.load(sessionId);
    expect(entries.find((e) => e.id === wakeId)?.status).toBe('fired');
    service.destroy();
  });

  it('R3 未知 wakeId ⇒ 不触发执行器（重建索引后仍未知）', async () => {
    const service = new SelfWakeService(new WakeStore(), 300_000);
    let called = false;
    setSelfWakeResumeHandler(async () => {
      called = true;
      return { ok: true };
    });

    await service.fire('non-existent-wake');

    expect(called).toBe(false);
    service.destroy();
  });
});
