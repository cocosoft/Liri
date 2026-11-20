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
import { StorageType } from '@modules/session/storage/UnifiedStorage';
import { FileSystemUnifiedStorage } from '@modules/session/storage/FileSystemUnifiedStorage';
import type { UnifiedMessage } from '@modules/session/types/UnifiedMessage';

/**
 * 注（2026-09-20）：本文件**可单文件运行**。此前受两条模块求值期循环导入影响，均已修复：
 * ① 存储注册循环（N-51：注册收敛到 `StorageFactory` + 调用时惰性注册）；
 * ② `FileSystemStorage` 构造期 `new AtomicWriter()` 触发的 TDZ（**N-54**：改为惰性创建写盘器）。
 */
const SID = 'sid-n51-fs';
let tmpRoot = '';
let storage: FileSystemUnifiedStorage;
function msg(
  id: string,
  content: string,
  blocks?: unknown[],
  sessionId: string = SID
): UnifiedMessage {
  return {
    id,
    sessionId,
    role: 'assistant',
    content,
    timestamp: 1,
    blocks,
  } as UnifiedMessage;
}

/** 投影文件当前行数（空行不计） */
function rowCount(sessionId: string = SID): number {
  const file = path.join(tmpRoot, sessionId, 'messages.jsonl');
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
    // 独立会话 + 自备前置数据：本用例断言的是"批量写相对基线行的增量"，不依赖上一例先跑
    const sid = 'sid-n51-batch';
    await storage.addMessage(sid, msg('m1', 'A', [{ type: 'text' }], sid));
    const before = rowCount(sid);

    // 全为同 id 且内容无变化 ⇒ 不写盘
    await storage.addMessages(sid, [msg('m1', 'A', [{ type: 'text' }], sid)]);
    expect(rowCount(sid)).toBe(before);

    // 一条新消息 + 一条无变化的旧消息 ⇒ 仅新消息写一行
    await storage.addMessages(sid, [
      msg('m2', 'B', undefined, sid),
      msg('m1', 'A', [{ type: 'text' }], sid),
    ]);
    expect(rowCount(sid)).toBe(before + 1);

    const out = await storage.getMessages(sid);
    expect(out.map((m) => m.id).sort()).toEqual(['m1', 'm2']);
  });
});

/**
 * 2026-11-18（真机 `session_mwkthat73b80a6724f`）：**单消息重复快照**按字节预算折叠。
 *
 * 实测缺陷：一条携带 ~1000 blocks 的 assistant 消息在一次长工具轮里被整行追加 **7 行 / 4.03 MB**
 *（占该会话投影的 88.8%，单行 ≈338 KB）；既有触发条件只有「追加 100 次」/「累计 2 MB」，
 * 6×338 KB ≈1.94 MB **恰好卡在阈值下方** ⇒ 一行都没折叠。
 * 修复后：按**每条消息**累计追加字节，达预算即复用既有 compact 折叠为一行。
 */
describe('2026-11-18：单消息重复快照达预算 ⇒ 自动折叠', () => {
  test('同 id 反复整行追加（blocks 每次变化）⇒ 行数不再随追加次数线性增长', async () => {
    const sid = 'sid-dup-budget';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dup-budget-'));
    const s = new FileSystemUnifiedStorage({
      type: StorageType.FILESYSTEM,
      basePath: dir,
      // 小预算：让"第 3 次左右追加"就命中，避免测试依赖真实 1 MB 体积
      duplicateAppendBudgetBytes: 800,
    });
    const mk = (n: number): UnifiedMessage =>
      ({
        id: 'm1',
        sessionId: sid,
        role: 'assistant',
        content: `v${n}`,
        timestamp: 1,
        blocks: [{ type: 'text', content: `${'x'.repeat(200)}${n}` }],
      }) as unknown as UnifiedMessage;
    const rows = (): number => {
      const file = path.join(dir, sid, 'messages.jsonl');
      if (!fs.existsSync(file)) return 0;
      return fs
        .readFileSync(file, 'utf-8')
        .split('\n')
        .filter((l) => l.trim().length > 0).length;
    };

    await s.addMessage(sid, mk(0));
    for (let i = 1; i <= 6; i += 1) {
      await s.updateMessage(sid, 'm1', mk(i));
    }

    // 读取语义不变：仍只有一条消息、且是最后写入的内容
    const stored = await s.getMessages(sid);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.content).toBe('v6');

    // 等写队列（含异步入队的 compact）落定后再数磁盘行
    await s.close();
    expect(rows()).toBeLessThan(7); // 朴素追加会是 1 + 6 = 7 行
    expect(rows()).toBeGreaterThanOrEqual(1);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
