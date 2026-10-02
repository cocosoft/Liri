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
 * P2-3（2026-09-26）：删除"仍在流式运行"的会话时，Windows 上目录被占用 ⇒
 * `rename` 到 `.trash` 抛 `EPERM` ⇒ 目录原地留存成"列表无·磁盘有"的孤儿
 * （实测 `2026-09-25T11:44:56.624Z`，`DELETE` 仍返 200）。
 *
 * 本文件锁定修法的两半：
 *  ① **拦写标记提前到 rename 之前** ⇒ 即便物理移动失败，后续落盘也不得把已删会话重建出来
 *    （原实现放在 rename 成功之后 ⇒ 失败时拦写一并失效，产出"只留 memory.md"的第二类孤儿）；
 *  ② **`renameToTrashWithRetry`** 对 `EPERM`/`EBUSY` 短退避重试 ⇒ 句柄释放后自愈。
 *
 * 用例 ② 依赖"目录内有打开的文件句柄"这一 Windows 语义（POSIX 下 rename 不受影响）⇒
 * 用 `skipIf` 显式跳过；并在用例内先做**前提探测**（持句柄时裸 `rename` 必须失败），
 * 前提不成立即判红，**不允许空绿**。
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StorageType } from '../../src/session/storage/UnifiedStorage';
import { FileSystemUnifiedStorage } from '../../src/session/storage/FileSystemUnifiedStorage';
import { SessionStatus, SessionType } from '../../src/session/types/UnifiedSession';
import type { UnifiedSession } from '../../src/session/types/UnifiedSession';
import type { UnifiedMessage } from '../../src/session/types/UnifiedMessage';

const SESSION_ID = 'sess-p2-3';

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

/** 隔离临时存储：1 个会话（已落 `session.json`），不调 `initialize()` 以免探测真实分区 */
async function setup(): Promise<{
  base: string;
  storage: FileSystemUnifiedStorage;
}> {
  const base = mkdtempSync(path.join(os.tmpdir(), 'p23-'));
  tmpRoots.push(base);
  const storage = new FileSystemUnifiedStorage({
    type: StorageType.FILESYSTEM,
    basePath: base,
  });
  await storage.createSession(mkSession(SESSION_ID));
  await storage.addMessage(SESSION_ID, mkMessage('m-1', SESSION_ID));
  expect(existsSync(path.join(base, SESSION_ID))).toBe(true);
  return { base, storage };
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (!root) continue;
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // @ignore-catch: 临时目录清理失败不影响断言结论
    }
  }
});

describe('P2-3：删除流式会话的软删除健壮性', () => {
  test('删除后对该会话的落盘被拦截 ⇒ 不重建目录（不产生第二类孤儿）', async () => {
    const { base, storage } = await setup();

    await storage.deleteSession(SESSION_ID);
    expect(existsSync(path.join(base, SESSION_ID))).toBe(false);

    // 模拟"删除后仍在飞的落盘"（协作式 abort 的滞后窗口）
    await storage.addMessage(SESSION_ID, mkMessage('m-late', SESSION_ID));

    expect(existsSync(path.join(base, SESSION_ID))).toBe(false);
  });

  test.skipIf(process.platform !== 'win32')(
    'Windows：目录被占用（EPERM）时 deleteSession 在有界重试内自愈',
    async () => {
      const { base, storage } = await setup();
      const dir = path.join(base, SESSION_ID);

      // 模拟在飞流持有的文件句柄（如 events.jsonl / session.json 正被写入）
      const handle = await fsp.open(path.join(dir, 'session.json'), 'r');

      // 前提探测：持句柄时裸 rename 必须失败 —— 否则本机复现不出该场景，
      // 用例会退化为"空绿"，故此处直接判红以暴露前提不成立。
      let rawCode: string | undefined;
      try {
        await fsp.rename(dir, `${dir}-probe`);
        await fsp.rename(`${dir}-probe`, dir);
      } catch (err) {
        rawCode = (err as NodeJS.ErrnoException).code;
      }
      expect(rawCode === 'EPERM' || rawCode === 'EBUSY').toBe(true);

      // 触发删除：第 1 次（t≈0ms）与第 2 次（t≈80ms）尝试都会失败，
      // 句柄在 t≈100ms 释放 ⇒ 第 3 次（t≈240ms）成功。
      const deleting = storage.deleteSession(SESSION_ID);
      setTimeout(() => {
        void handle.close();
      }, 100);
      await deleting;

      expect(existsSync(dir)).toBe(false);
      const trashEntries = readdirSync(path.join(base, '.trash'));
      expect(trashEntries.some((n) => n.startsWith(`${SESSION_ID}_`))).toBe(
        true
      );
    }
  );
});
