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
 * A：**分区路由**回归（2026-09-26）——读 / 写 / 删以"会话实体所在分区"为准。
 *
 * 修复前的真实根因（线上实测，见台账同名条目 + `app.log.2026-09-25T15-42-48-870Z:53646-53661`）：
 * 会话实体位于历史分区（如 `sessions/default/`），而读写恒用 `this.basePath` ⇒
 * ① `loadMessages` 永远 ENOENT（历史分区的消息读不到）⇒ 被 K-6 判"僵尸"软删；
 * ② 同时 `isSessionDirPresent` 因历史分区副本返回 true ⇒ 写盘放行，并在 basePath **新建
 * "只有 `session.json`"的副本** ⇒ 副本下一轮又判僵尸 ⇒ **每次启动一个残骸、无终止条件**
 * （实测单会话被删 **533 次**、`57971aa3/.trash` **7002 项 / 97.55MB**；真机核对该 id 至今
 * 仍活在 `default/`，`messages.jsonl` 为 0 字节）。
 *
 * 本文件把修复后的口径钉死：① 消息从**历史分区**读到；② 元数据**就地写**历史分区（不在
 * basePath 造副本）；③ 删除落在**历史分区自己的** `.trash`；④ 多轮读写**零残骸**（原循环消失）。
 *
 * 注意：不调用 `initialize()`——避免 `purgeExpiredTrash()` 扫到真实数据目录的顶层 `.trash`；
 * 分区清单经构造参数 `legacyRoots` 直接注入。
 */
import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StorageType } from '../../src/session/storage/UnifiedStorage';
import { FileSystemUnifiedStorage } from '../../src/session/storage/FileSystemUnifiedStorage';
import type { UnifiedSession } from '../../src/session/types/Session';
import { SessionStatus, SessionType } from '../../src/session/types/Session';

const ID = 'session_xpart_1';

const tmpRoots: string[] = [];

interface Fixture {
  basePath: string;
  legacyRoot: string;
  session: UnifiedSession;
}

function mkTmp(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(root);
  return root;
}

/** 造"会话实体在历史分区、当前分区为空"的线上形态（含一条真实消息） */
function mkCrossPartition(prefix: string, withMessage = true): Fixture {
  const root = mkTmp(prefix);
  const basePath = path.join(root, 'sessions', '57971aa3');
  const legacyRoot = path.join(root, 'sessions', 'default');
  fs.mkdirSync(basePath, { recursive: true });

  const now = Date.now();
  const session: UnifiedSession = {
    id: ID,
    type: SessionType.CHAT,
    title: '跨分区会话',
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    status: SessionStatus.PAUSED,
    metadata: { totalMessages: withMessage ? 1 : 0 },
  };
  const legacyDir = path.join(legacyRoot, ID);
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(
    path.join(legacyDir, 'session.json'),
    JSON.stringify(session),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(legacyDir, 'messages.jsonl'),
    withMessage
      ? JSON.stringify({
          id: 'm-legacy-1',
          sessionId: ID,
          role: 'user',
          content: '来自历史分区',
          timestamp: 1,
        }) + '\n'
      : '',
    'utf-8'
  );
  return { basePath, legacyRoot, session };
}

/** 新实例 = 新一轮启动（内存缓存与 `deletedSessionIds` 均为空） */
function mkStorage(fx: Fixture): FileSystemUnifiedStorage {
  return new FileSystemUnifiedStorage({
    type: StorageType.FILESYSTEM,
    basePath: fx.basePath,
    legacyRoots: [fx.legacyRoot],
  });
}

function trashEntries(dir: string): string[] {
  const trash = path.join(dir, '.trash');
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

describe('A 分区路由：读 / 写 / 删均以实体所在分区为准', () => {
  test('① 读：历史分区的消息**能读到**（修复前恒 ENOENT ⇒ 被判僵尸）', async () => {
    const fx = mkCrossPartition('xpart-read-');
    const storage = mkStorage(fx);

    const msgs = await storage.getMessages(ID);

    expect(msgs.map((m) => m.id)).toEqual(['m-legacy-1']);
    expect(msgs[0].content).toBe('来自历史分区');
    // 未产生任何残骸 / 副本
    expect(trashEntries(fx.basePath)).toEqual([]);
    expect(fs.existsSync(path.join(fx.basePath, ID))).toBe(false);
  });

  test('② 写：元数据**就地写历史分区**，不在当前分区造副本', async () => {
    const fx = mkCrossPartition('xpart-write-');
    const storage = mkStorage(fx);

    await storage.updateSession({ ...fx.session, title: '改名了' });

    const legacyMeta = JSON.parse(
      fs.readFileSync(path.join(fx.legacyRoot, ID, 'session.json'), 'utf-8')
    ) as UnifiedSession;
    expect(legacyMeta.title).toBe('改名了');
    // 关键回归：当前分区**没有**被造出"只有 session.json"的空壳
    expect(fs.existsSync(path.join(fx.basePath, ID))).toBe(false);
  });

  test('③ 消息写：追加也落在历史分区（不在当前分区造半边目录）', async () => {
    const fx = mkCrossPartition('xpart-append-');
    const storage = mkStorage(fx);

    await storage.addMessage(ID, {
      id: 'm-legacy-2',
      sessionId: ID,
      role: 'user',
      content: '第二条',
      timestamp: 2,
    } as never);

    const rows = fs
      .readFileSync(path.join(fx.legacyRoot, ID, 'messages.jsonl'), 'utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    expect(rows).toHaveLength(2);
    expect(fs.existsSync(path.join(fx.basePath, ID))).toBe(false);
  });

  test('④ 删：落在**历史分区自己的** .trash（当前分区不产生残骸）', async () => {
    const fx = mkCrossPartition('xpart-delete-');
    const storage = mkStorage(fx);

    await storage.deleteSession(ID);

    expect(fs.existsSync(path.join(fx.legacyRoot, ID))).toBe(false);
    expect(trashEntries(fx.legacyRoot)).toHaveLength(1);
    expect(trashEntries(fx.basePath)).toEqual([]);
  });

  test('⑤ 回归：多轮"读 + 写元数据"**零残骸**（线上 533 次的循环消失）', async () => {
    const fx = mkCrossPartition('xpart-loop-', false);
    for (let round = 0; round < 3; round++) {
      const storage = mkStorage(fx); // 每轮新实例 = 每次重启
      expect(await storage.getMessages(ID)).toEqual([]);
      await storage.updateSession({ ...fx.session, title: `轮次${round}` });
    }

    expect(trashEntries(fx.basePath)).toEqual([]);
    expect(trashEntries(fx.legacyRoot)).toEqual([]);
    expect(fs.existsSync(path.join(fx.basePath, ID))).toBe(false);
    // 源分区仍完好（未被误删、且被就地更新）
    const meta = JSON.parse(
      fs.readFileSync(path.join(fx.legacyRoot, ID, 'session.json'), 'utf-8')
    ) as UnifiedSession;
    expect(meta.title).toBe('轮次2');
  });

  test('对照组：当前分区会话行为不变（消息写 basePath、删除进 basePath/.trash）', async () => {
    const fx = mkCrossPartition('xpart-control-');
    const storage = mkStorage(fx);
    const localId = 'session_local_1';
    await storage.createSession({
      ...fx.session,
      id: localId,
      title: '当前分区',
    });
    await storage.addMessage(localId, {
      id: 'm-local-1',
      sessionId: localId,
      role: 'user',
      content: '本地',
      timestamp: 1,
    } as never);

    expect(fs.existsSync(path.join(fx.basePath, localId, 'messages.jsonl'))).toBe(
      true
    );
    await storage.deleteSession(localId);
    expect(trashEntries(fx.basePath)).toHaveLength(1);
    expect(trashEntries(fx.legacyRoot)).toEqual([]);
  });
});
