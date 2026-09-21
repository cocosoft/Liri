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
 * N-51 写入侧（2026-09-20）：内存消息列表 **id 唯一**不变式。
 *
 * 背景：`loadMessages`（从磁盘加载）已由 Map 保证"后写覆盖"；但**写入侧**原先不保证 ——
 * `addMessage` / `addMessages` 一律 push ⇒ 上游重发/双写会让同 id 在内存数组出现两项，
 * 而 `ensureMessagesLoaded` 见内存已有该会话便不再重载 ⇒ 重复长期外溢到接口与 UI
 *（React key 冲突 / 渲染两次，即 N-51 症状）。本组测试守护收敛后的不变式。
 */
import { describe, expect, test } from 'bun:test';
import { StorageType } from '../../src/session/storage/UnifiedStorage';
import { MemoryUnifiedStorage } from '../../src/session/storage/MemoryUnifiedStorage';
import { StorageFactory } from '../../src/session/storage/StorageFactory';
import type { UnifiedMessage } from '../../src/session/types/Message';

/**
 * 注（2026-09-20）：存储注册已收敛到 `StorageFactory`（单一注册中枢），实现模块不再反向 import
 * 工厂 ⇒ 此前的循环导入/TDZ 已消除，本文件**可单文件运行**（`bun test <本文件>`）。
 */
const SID = 'sid-n51';

function newStorage(): MemoryUnifiedStorage {
  return new MemoryUnifiedStorage({ type: StorageType.MEMORY });
}

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

describe('N-51 写入侧：内存消息 id 唯一', () => {
  test('addMessage 同 id 两次 ⇒ 只保留一条（后写覆盖）', async () => {
    const s = newStorage();
    await s.addMessage(SID, msg('m1', 'A'));
    await s.addMessage(SID, msg('m1', 'B'));

    const out = await s.getMessages(SID);
    expect(out.length).toBe(1);
    expect(out[0].content).toBe('B');
  });

  test('addMessages 批量含重复 id ⇒ 只保留一条（后写覆盖）', async () => {
    const s = newStorage();
    await s.addMessages(SID, [msg('m1', 'A'), msg('m2', 'X'), msg('m1', 'B')]);

    const out = await s.getMessages(SID);
    expect(out.length).toBe(2);
    expect(out.map((m) => `${m.id}:${m.content}`).sort()).toEqual([
      'm1:B',
      'm2:X',
    ]);
  });

  test('updateMessage 同 id 为替换语义（不新增条目）', async () => {
    const s = newStorage();
    await s.addMessage(SID, msg('m1', 'A'));
    await s.updateMessage(SID, 'm1', msg('m1', 'A', [{ type: 'text' }]));

    const out = await s.getMessages(SID);
    expect(out.length).toBe(1);
    expect(Array.isArray(out[0].blocks)).toBe(true);
  });
});

describe('存储注册收敛（循环导入消除后不回退）', () => {
  test('StorageFactory 仍注册内置实现，且可创建实例', async () => {
    expect(StorageFactory.isRegistered(StorageType.MEMORY)).toBe(true);
    expect(StorageFactory.isRegistered(StorageType.FILESYSTEM)).toBe(true);

    const created = StorageFactory.createStorage({ type: StorageType.MEMORY });
    expect(created).toBeTruthy();
    expect(Array.isArray(await created.getMessages('sid-none'))).toBe(true);
  });
});
