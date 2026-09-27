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
 * `resolvePendingWake` 契约测试（等待态可见性，2026-09-27）
 *
 * Spec：`.trae/specs/wait-state-visibility.md` §3.1(b) —— `GET /v1/sessions/{id}/streaming`
 * 的 `pendingWake` 字段。断言的是**字段构造语义**（有/无、取最早、只算待触发），
 * 不 mock 任何模块（避免 `mock.module` 的进程级污染，见台账 2026-09-27 条目）。
 *
 * 数据源用**真实** `WakeStore`（`PYAPP_DATA_DIR` 指向临时目录）+ 真实 `SelfWakeService`。
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// 覆盖 PYAPP_DATA_DIR，避免污染真实数据（须在导入 WakeStore 前设置）
const testDataDir = join(tmpdir(), `liri-pending-wake-${randomUUID()}.d`);
process.env.PYAPP_DATA_DIR = testDataDir;

const { createCg3Services, getCg3SelfWakeService } = await import(
  '../../src/tasks/Cg3Bootstrap'
);
const { resolvePendingWake } = await import(
  '../../src/infrastructure/http/handlers/sessionWaitFields'
);

describe('resolvePendingWake（会话待触发唤醒只读字段）', () => {
  beforeAll(() => {
    mkdirSync(testDataDir, { recursive: true });
    // tickInterval=1 ⇒ 所有时长都走"长时"路径，不创建 setTimeout（避免悬挂句柄）
    createCg3Services({ cronTickIntervalMs: 1 });
  });

  afterAll(() => {
    try {
      if (existsSync(testDataDir)) {
        rmSync(testDataDir, { recursive: true, force: true });
      }
    } catch {
      /* best-effort */
    }
  });

  it('无待触发记录 ⇒ undefined（不造默认值）', async () => {
    expect(await resolvePendingWake('no-such-session')).toBeUndefined();
  });

  it('sleep_for 待触发 ⇒ 返回 kind=timer + 真实 triggerAt', async () => {
    const selfWake = getCg3SelfWakeService();
    expect(selfWake).not.toBeNull();
    const sessionId = 'pending-wake-single';
    const before = Date.now();

    await selfWake!.sleepFor(sessionId, 'task-1', 60);

    const field = await resolvePendingWake(sessionId);
    expect(field).toBeDefined();
    expect(field!.kind).toBe('timer');
    // 真实测量值：now + 60s（留 ±10s 余量，不改口径）
    expect(field!.triggerAt).toBeGreaterThan(before + 50_000);
    expect(field!.triggerAt).toBeLessThan(Date.now() + 70_000);
    expect(field!.createdAt).toBeGreaterThanOrEqual(before);
  });

  it('多条待触发 ⇒ 取 triggerAt 最早的一条', async () => {
    const selfWake = getCg3SelfWakeService();
    const sessionId = 'pending-wake-multi';

    await selfWake!.sleepFor(sessionId, 'task-1', 600);
    await selfWake!.sleepFor(sessionId, 'task-1', 60);

    const field = await resolvePendingWake(sessionId);
    // 最早那条 = 60s 那条（600s 那条的 triggerAt 在 10 分钟之后）
    expect(field!.triggerAt).toBeLessThan(Date.now() + 70_000);
  });

  it('无 triggerAt 的等待（wake_on_job）⇒ 省略 triggerAt，只给 kind', async () => {
    const selfWake = getCg3SelfWakeService();
    const sessionId = 'pending-wake-job';

    await selfWake!.wakeOnJob(sessionId, 'task-1', 'job-1');

    const field = await resolvePendingWake(sessionId);
    expect(field).toBeDefined();
    expect(field!.kind).toBe('completion');
    expect(field!.triggerAt).toBeUndefined(); // 不伪造剩余时间
  });

  it('仅已 fired 的记录 ⇒ undefined（只算待触发）', async () => {
    const selfWake = getCg3SelfWakeService();
    const sessionId = 'pending-wake-fired';

    const entry = await selfWake!.sleepFor(sessionId, 'task-1', 60);
    await selfWake!.fire(entry.id);

    expect(await resolvePendingWake(sessionId)).toBeUndefined();
  });
});
