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
 * TB-14（2026-09-24）：**跨进程软删除**后，存储层各读/写路径的统一口径。
 *
 * 背景：`FileSystemUnifiedStorage` 的内存 `sessions` Map 只与"本进程写操作"同步——
 * 另一个进程（CLI 命令 / 第二个实例）把会话目录 rename 到 `.trash` 时，本进程一无所知，
 * 于是"幽灵会话"会被各读方法当有效返回（实测：`current` / `list` / 详情 / 统计全部中招），
 * 写路径的 `fs.mkdir(recursive)` 还会把目录**重建**（幽灵复活）。
 *
 * 本文件把"内存 Map ⊆ 磁盘目录"这一不变式的**读侧全部方法与写侧拦截**固化为回归用例 ——
 * 这些路径多数**无 HTTP 路由**（`getSessionStats`/`getSessionMessageCount` 仅 CLI 消费），
 * 无法真机取证，故以本用例为据。
 */
import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StorageType } from '../../src/session/storage/UnifiedStorage';
import { FileSystemUnifiedStorage } from '../../src/session/storage/FileSystemUnifiedStorage';
import type { UnifiedSession } from '../../src/session/types/Session';
import { SessionStatus, SessionType } from '../../src/session/types/Session';
import type { UnifiedMessage } from '../../src/session/types/Message';

const KEEP_ID = 'sess-keep';
const GONE_ID = 'sess-gone';

const tmpRoots: string[] = [];

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

function mkMessage(id: string, sessionId: string): UnifiedMessage {
  return {
    id,
    sessionId,
    role: 'user',
    content: 'hello',
    timestamp: 1,
  } as UnifiedMessage;
}

/**
 * 建一个隔离的临时存储：两个会话（`sess-keep` 保留 / `sess-gone` 待外部删除），
 * 其中 `sess-gone` 带 1 条消息，随后**模拟另一进程的软删除**（整目录 rename 到 `.trash`）。
 * 注意：不调用 `initialize()`——避免 `resolveLegacySessionPartitionRoots()` 探测真实分区目录。
 */
async function setupExternallyDeleted(): Promise<{
  base: string;
  storage: FileSystemUnifiedStorage;
}> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tb14-'));
  tmpRoots.push(base);
  const storage = new FileSystemUnifiedStorage({
    type: StorageType.FILESYSTEM,
    basePath: base,
  });
  await storage.createSession(mkSession(KEEP_ID));
  await storage.createSession(mkSession(GONE_ID));
  await storage.addMessage(GONE_ID, mkMessage('m-gone-1', GONE_ID));

  // 前置断言：删除前一切正常（避免"因建库失败而误绿"）
  expect(await storage.getSession(GONE_ID)).not.toBeNull();
  expect(await storage.getSessionMessageCount(GONE_ID)).toBe(1);

  // 外部软删除：另一进程把目录 rename 到 .trash（内存 Map 不动）
  fs.mkdirSync(path.join(base, '.trash'), { recursive: true });
  fs.renameSync(
    path.join(base, GONE_ID),
    path.join(base, '.trash', `${GONE_ID}_1`)
  );
  return { base, storage };
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

describe('TB-14：跨进程软删除后的读路径（内存 Map 回查磁盘）', () => {
  test('getSession：磁盘目录已消失 ⇒ 返回 null（不再外泄幽灵）', async () => {
    const { storage } = await setupExternallyDeleted();
    expect(await storage.getSession(GONE_ID)).toBeNull();
    // 正向控制：未删除的会话不受影响
    expect((await storage.getSession(KEEP_ID))?.id).toBe(KEEP_ID);
  });

  test('listSessions：排除幽灵并摘除内存条目；正常会话保留', async () => {
    const { storage } = await setupExternallyDeleted();
    const ids = (await storage.listSessions()).map((s) => s.id);
    expect(ids).toEqual([KEEP_ID]);
  });

  test('searchSessions：排除幽灵（按 id 与标题都搜不到）', async () => {
    const { storage } = await setupExternallyDeleted();
    expect((await storage.searchSessions(GONE_ID)).length).toBe(0);
    // 正向控制：正常会话仍可搜到
    expect((await storage.searchSessions(KEEP_ID)).length).toBe(1);
  });

  test('getSessionMessageCount：幽灵返回 0（不再返回陈旧计数）', async () => {
    const { storage } = await setupExternallyDeleted();
    expect(await storage.getSessionMessageCount(GONE_ID)).toBe(0);
    expect(await storage.getSessionMessageCount(KEEP_ID)).toBe(0);
  });

  test('getSessionStats：单会话查询归零、全量统计不计入幽灵', async () => {
    const { storage } = await setupExternallyDeleted();
    const one = await storage.getSessionStats(GONE_ID);
    expect(one.totalSessions).toBe(0);
    expect(one.sessions).toEqual([]);

    const all = await storage.getSessionStats();
    expect(all.totalSessions).toBe(1);
    expect(all.sessions).toEqual([KEEP_ID]);
  });

  test('写侧拦截：对幽灵 addMessage 不重建目录（不复活）', async () => {
    const { base, storage } = await setupExternallyDeleted();
    const dir = path.join(base, GONE_ID);
    expect(fs.existsSync(dir)).toBe(false);

    await storage.addMessage(GONE_ID, mkMessage('m-revive-1', GONE_ID));

    // R1 修复前：persistMessageAppend 的 mkdir(recursive) 会把目录重建（幽灵复活）
    expect(fs.existsSync(dir)).toBe(false);
    // 且内存条目被摘除 ⇒ 后续读取仍按"不存在"处理
    expect(await storage.getSession(GONE_ID)).toBeNull();
    expect(await storage.getSessionMessageCount(GONE_ID)).toBe(0);
  });
});
