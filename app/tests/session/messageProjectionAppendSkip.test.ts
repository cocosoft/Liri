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
 * N-51 写入侧（2026-09-20）：投影（`messages.jsonl`）**不写冗余行**。
 *
 * 实测缺陷：同一 assistant 消息在投影中出现 **4 行**，其中最后一行与前一行**字节完全一致**
 *（blocks 未变化的重复 `updateMessage` 仍然追加）⇒ 长会话下写放大并放大 compact 压力。
 * 修复后：同 id 且内容无变化 ⇒ 不再追加；内容变化（如 blocks 更新）⇒ 仍按"追加 + 后写覆盖"
 * 语义写一行（磁盘行为不变，读取仍按 `loadMessages` 的 Map 反向去重）。
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StorageType } from '../../src/session/storage/UnifiedStorage';
import { FileSystemUnifiedStorage } from '../../src/session/storage/FileSystemUnifiedStorage';
import type { UnifiedMessage } from '../../src/session/types/Message';

/**
 * 注（2026-09-20）：本文件**可单文件运行**。此前受两条模块求值期循环导入影响，均已修复：
 * ① 存储注册循环（N-51：注册收敛到 `StorageFactory` + 调用时惰性注册）；
 * ② `FileSystemStorage` 构造期 `new AtomicWriter()` 触发的 TDZ（**N-54**：改为惰性创建写盘器）。
 */
const SID = 'sid-n51-fs';
let tmpRoot = '';
let storage: FileSystemUnifiedStorage;
function msg(id: string, content: string, blocks?: unknown[]): UnifiedMessage {
  return {
    id,
    sessionId: SID,
    role: 'assistant',
    content,
    timestamp: 1,
    blocks,
  } as UnifiedMessage;
}

/** 投影文件当前行数（空行不计） */
function rowCount(): number {
  const file = path.join(tmpRoot, SID, 'messages.jsonl');
  if (!fs.existsSync(file)) return 0;
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0).length;
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'n51-'));
  storage = new FileSystemUnifiedStorage({
    type: StorageType.FILESYSTEM,
    basePath: tmpRoot,
  });
});

afterAll(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // 清理失败不影响测试结论
  }
});

describe('N-51 写入侧：投影无冗余追加', () => {
  test('addMessage / updateMessage 内容无变化 ⇒ 不再追加行；内容变化 ⇒ 追加一行', async () => {
    await storage.addMessage(SID, msg('m1', 'A'));
    expect(rowCount()).toBe(1);

    // 同 id 同内容再次投递（模拟上游重发/双写）
    await storage.addMessage(SID, msg('m1', 'A'));
    expect(rowCount()).toBe(1);
    expect((await storage.getMessages(SID)).length).toBe(1);

    // 同内容更新（blocks 未变）
    await storage.updateMessage(SID, 'm1', msg('m1', 'A'));
    expect(rowCount()).toBe(1);

    // 内容变化（blocks 更新）⇒ 正常追加一行，内存仍只有一条
    await storage.updateMessage(SID, 'm1', msg('m1', 'A', [{ type: 'text' }]));
    expect(rowCount()).toBe(2);
    expect((await storage.getMessages(SID)).length).toBe(1);
  });

  test('addMessages 批量：同 id 替换、无变化不落盘、仅新消息写一行', async () => {
    const before = rowCount();

    // 全为同 id 且内容无变化 ⇒ 不写盘
    await storage.addMessages(SID, [msg('m1', 'A', [{ type: 'text' }])]);
    expect(rowCount()).toBe(before);

    // 一条新消息 + 一条无变化的旧消息 ⇒ 仅新消息写一行
    await storage.addMessages(SID, [
      msg('m2', 'B'),
      msg('m1', 'A', [{ type: 'text' }]),
    ]);
    expect(rowCount()).toBe(before + 1);

    const out = await storage.getMessages(SID);
    expect(out.map((m) => m.id).sort()).toEqual(['m1', 'm2']);
  });
});
