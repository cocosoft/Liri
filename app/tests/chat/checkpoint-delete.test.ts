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
 * 删除会话联动清理检查点 — 底层存储行为测试
 *
 * 背景：P2 存量水位清理发现「删除会话不联动清理检查点」——
 * FileCheckpointStorage 检查点文件按 `checkpoint-{sessionId}-{checkpointId}.json`
 * 命名，删除会话时必须删除该会话全部检查点文件，避免 12GB 级孤儿堆积。
 *
 * 覆盖（对应 ChatManager.deleteSession / clearAllSessions 联动的底层能力）：
 * - deleteSessionCheckpoints 精确删除指定会话全部检查点文件
 * - 不误删其他会话的检查点
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileCheckpointStorage } from '../../src/query/FileCheckpointStorage.js';

describe('FileCheckpointStorage.deleteSessionCheckpoints', () => {
  let dir: string;
  let storage: FileCheckpointStorage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cp-cleanup-'));
    storage = new FileCheckpointStorage(dir);
    // 模拟：sessionA 2 个检查点、sessionB 1 个检查点、1 个无关文件
    const names = [
      'checkpoint-sessionA-cp_aaa.json',
      'checkpoint-sessionA-cp_bbb.json',
      'checkpoint-sessionB-cp_ccc.json',
      'unrelated-file.json',
    ];
    for (const name of names) {
      writeFileSync(
        join(dir, name),
        JSON.stringify({ id: name, sessionId: name.split('-')[1] })
      );
    }
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('删除指定会话的全部检查点文件', async () => {
    await storage.deleteSessionCheckpoints('sessionA');
    const files = readdirSync(dir);
    expect(files).not.toContain('checkpoint-sessionA-cp_aaa.json');
    expect(files).not.toContain('checkpoint-sessionA-cp_bbb.json');
  });

  it('不误删其他会话的检查点与无关文件', async () => {
    await storage.deleteSessionCheckpoints('sessionA');
    const files = readdirSync(dir);
    expect(files).toContain('checkpoint-sessionB-cp_ccc.json');
    expect(files).toContain('unrelated-file.json');
  });

  it('会话无检查点时无副作用', async () => {
    await storage.deleteSessionCheckpoints('sessionNotFound');
    const files = readdirSync(dir);
    expect(files).toHaveLength(4);
  });
});
