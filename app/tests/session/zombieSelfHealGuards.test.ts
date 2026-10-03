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
 * K-6「僵尸会话自愈」的两道守卫（2026-09-26，`.trash` 高速累积收口）。
 *
 * 背景：`loadMessages` 在 `messages.jsonl` ENOENT 且 `session.json` 存在时会**自动把会话软删**
 * （rename 进 `.trash`）。线上实测该分支被反复命中：单个会话被删 **533 次**、`.trash` 累积
 * **7002 项 / 97.55MB**（真实根因是**跨分区写盘错位**，见
 * `crossPartitionZombieLoop.test.ts` 与台账同名条目）。
 *
 * 本文件只钉死本分支自身加的两道守卫：
 * - ②-1 本进程已软删过该会话 ⇒ 不再重复自愈（否则每次命中都留一个残骸）；
 * - ②-2 目录内除 `session.json` 外还有其它产物（`events.jsonl` / `memory.md` 等）⇒ **不自愈**
 *   （那是有真实数据的会话，删进 `.trash` 会丢数据；事件日志可重建消息投影）。
 *
 * 注意：不调用 `initialize()`——避免 `purgeExpiredTrash()` 扫到真实数据目录的顶层 `.trash`。
 */
import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StorageType } from '../../src/session/storage/UnifiedStorage';
import { FileSystemUnifiedStorage } from '../../src/session/storage/FileSystemUnifiedStorage';
import type { UnifiedSession } from '../../src/session/types/UnifiedSession';
import {
  SessionStatus,
  SessionType,
} from '../../src/session/types/UnifiedSession';

const tmpRoots: string[] = [];

function mkBase(prefix: string): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(base);
  return base;
}

/** 新实例 ⇒ 消息缓存为空 ⇒ `getMessages` 会真正读盘并走到 K-6 分支 */
function mkStorage(base: string): FileSystemUnifiedStorage {
  return new FileSystemUnifiedStorage({
    type: StorageType.FILESYSTEM,
    basePath: base,
  });
}

function mkSession(id: string): UnifiedSession {
  const now = Date.now();
  return {
    id,
    type: SessionType.CHAT,
    title: id,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    status: SessionStatus.ACTIVE,
    metadata: {},
  };
}

function sessionDir(base: string, id: string): string {
  return path.join(base, id);
}

function trashEntries(base: string): string[] {
  const trash = path.join(base, '.trash');
  if (!fs.existsSync(trash)) return [];
  return fs.readdirSync(trash).sort();
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (!root) continue;
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // 清理失败不影响测试结论
    }
  }
});

describe('K-6 僵尸自愈的守卫（数据保护 + 不重复）', () => {
  test('对照组：真僵尸（仅 session.json，无其它产物）仍自愈进 .trash', async () => {
    const base = mkBase('k6-true-');
    const creator = mkStorage(base);
    await creator.createSession(mkSession('zombie-1'));
    // 模拟消息文件丢失（真僵尸的定义）
    fs.rmSync(path.join(sessionDir(base, 'zombie-1'), 'messages.jsonl'));

    const reader = mkStorage(base);
    expect(await reader.getMessages('zombie-1')).toEqual([]);

    expect(fs.existsSync(sessionDir(base, 'zombie-1'))).toBe(false);
    expect(trashEntries(base)).toHaveLength(1);
  });

  test('守卫 ②-2：目录含 events.jsonl 等真实产物 ⇒ 不自愈（避免丢数据）', async () => {
    const base = mkBase('k6-artifacts-');
    const creator = mkStorage(base);
    await creator.createSession(mkSession('keeper-1'));
    fs.rmSync(path.join(sessionDir(base, 'keeper-1'), 'messages.jsonl'));
    // 真实产物：事件日志（可据此重建消息投影）⇒ 不是"空壳僵尸"
    fs.writeFileSync(
      path.join(sessionDir(base, 'keeper-1'), 'events.jsonl'),
      '{"type":"session.created"}\n',
      'utf-8'
    );

    const reader = mkStorage(base);
    expect(await reader.getMessages('keeper-1')).toEqual([]);

    expect(fs.existsSync(sessionDir(base, 'keeper-1'))).toBe(true);
    expect(
      fs.existsSync(path.join(sessionDir(base, 'keeper-1'), 'events.jsonl'))
    ).toBe(true);
    expect(trashEntries(base)).toEqual([]);
  });

  test('守卫 ②-1：本进程已软删过该会话 ⇒ 不再重复自愈（不产生第二个 .trash 残骸）', async () => {
    const base = mkBase('k6-oneshot-');
    const storage = mkStorage(base);
    await storage.createSession(mkSession('zombie-2'));
    await storage.deleteSession('zombie-2');
    expect(trashEntries(base)).toHaveLength(1);

    // 模拟"另一实例把目录重建回来"（只有 session.json，正是线上空壳形态）
    fs.mkdirSync(sessionDir(base, 'zombie-2'), { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir(base, 'zombie-2'), 'session.json'),
      JSON.stringify(mkSession('zombie-2')),
      'utf-8'
    );

    expect(await storage.getMessages('zombie-2')).toEqual([]);

    // 修复前：每次命中都 rename ⇒ 残骸数量随启动次数线性增长（线上达 533 个）
    expect(trashEntries(base)).toHaveLength(1);
  });
});
