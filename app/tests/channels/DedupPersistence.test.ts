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
 * PR4 遗留-⑨ — 去重处理态落盘测试（2026-10-09）
 *
 * 覆盖 `.trae/specs/dedup-message-state.md`：跨重启仍阻断同 messageId 重传（验收 ⑨）。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { unlinkSync, existsSync } from 'fs';
import { DedupStore } from '../../src/channels/dedup/DedupStore.js';
import {
  attachDedupStore,
  hydrateFromDedupStore,
  resetDedupState,
  claimMessage,
  finalizeMessage,
  releaseProcessing,
} from '../../src/channels/dedup/index.js';

const dbPath = join(
  tmpdir(),
  `liri-dedup-test-${Date.now()}-${Math.floor(performance.now())}.db`
);
const store = new DedupStore(dbPath);

/** 等待 best-effort 写盘落定 */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

let seq = 0;
const uid = (): string => `dedup-persist-${Date.now()}-${seq++}`;

afterAll(() => {
  attachDedupStore(null);
  resetDedupState();
  store.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        // @ignore-catch — 测试清理：Windows 下可能仍被占用
      }
    }
  }
});

describe('PR4-⑨ 去重处理态落盘', () => {
  it('claim/finalize 写盘；重启（清内存）后 hydrate ⇒ 仍判 duplicate', async () => {
    attachDedupStore(store);
    resetDedupState();

    const id = uid();
    expect(claimMessage(id)).toBe('claimed');
    await flush();
    expect(finalizeMessage(id, true)).toBe(true);
    await flush();

    const live = await store.loadLive();
    const row = live.find((r) => r.messageId === id);
    expect(row?.state).toBe('ADMITTED');

    // 模拟进程重启：解绑持久化 + 清内存（磁盘仍在）
    attachDedupStore(null);
    resetDedupState();
    expect(claimMessage(id)).toBe('claimed'); // 未 hydrate ⇒ 内存无记录

    // 启动期 hydrate 后 ⇒ 同 messageId 被阻断（验收 ⑨）
    const { loaded } = await hydrateFromDedupStore(store);
    expect(loaded).toBeGreaterThanOrEqual(1);
    expect(claimMessage(id)).toBe('duplicate');
  });

  it('releaseProcessing 删除磁盘行', async () => {
    attachDedupStore(store);
    const id = uid();
    claimMessage(id);
    await flush();
    releaseProcessing(id);
    await flush();
    const live = await store.loadLive();
    expect(live.find((r) => r.messageId === id)).toBeUndefined();
  });

  it('purgeExpired 清理过期行', async () => {
    await store.upsert('expired-1', 'ADMITTED', Date.now() - 1000);
    const removed = await store.purgeExpired();
    expect(removed).toBeGreaterThanOrEqual(1);
    const live = await store.loadLive();
    expect(live.find((r) => r.messageId === 'expired-1')).toBeUndefined();
  });

  it('未接入 store ⇒ 纯内存（零行为变更）', () => {
    attachDedupStore(null);
    resetDedupState();
    const id = uid();
    expect(claimMessage(id)).toBe('claimed');
    expect(claimMessage(id)).toBe('inflight');
  });
});
