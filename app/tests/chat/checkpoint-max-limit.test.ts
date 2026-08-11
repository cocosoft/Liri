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
 * FileCheckpointStorage 每会话检查点上限（enforceMaxCheckpoints）测试
 *
 * 背景：文件检查点曾无限累积（12GB 级堆积）。方案 A 修复：saveCheckpoint 后
 * 对齐 CheckpointDatabase.enforceMaxCheckpoints，每会话自动检查点上限
 * CHECKPOINT_MAX_AUTO（50），仅清理 autoCreated 的最旧检查点，保留手动检查点。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileCheckpointStorage } from '../../src/query/FileCheckpointStorage';
import { CHECKPOINT_MAX_AUTO } from '../../src/chat/types/checkpoint';
import type { SessionCheckpoint } from '../../src/chat/types/checkpoint';

function makeCp(
  sessionId: string,
  id: string,
  createdAt: number,
  autoCreated: boolean
): SessionCheckpoint {
  return {
    id,
    sessionId,
    createdAt,
    messages: [],
    metadata: { title: '' },
    state: 'active',
    autoCreated,
  } as SessionCheckpoint;
}

describe('FileCheckpointStorage.enforceMaxCheckpoints', () => {
  let dir: string;
  let storage: FileCheckpointStorage;
  const sid = 'session_limit_test';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cp-limit-'));
    storage = new FileCheckpointStorage(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it(`超过 ${CHECKPOINT_MAX_AUTO} 个自动检查点时删除最旧（保持上限）`, async () => {
    const total = CHECKPOINT_MAX_AUTO + 5;
    for (let i = 0; i < total; i++) {
      await storage.saveCheckpoint(makeCp(sid, `cp_auto_${i}`, i, true));
    }
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(CHECKPOINT_MAX_AUTO);
    // 最旧 5 个被删（cp_auto_0 ~ cp_auto_4），最新保留
    expect(files).not.toContain(`checkpoint-${sid}-cp_auto_0.json`);
    expect(files).not.toContain(`checkpoint-${sid}-cp_auto_4.json`);
    expect(files).toContain(`checkpoint-${sid}-cp_auto_${total - 1}.json`);
  });

  it('手动检查点（autoCreated=false）不被清理', async () => {
    // 先写 3 个手动检查点，再写超过上限的自动检查点
    for (let i = 0; i < 3; i++) {
      await storage.saveCheckpoint(
        makeCp(sid, `cp_manual_${i}`, 1000 + i, false)
      );
    }
    const totalAuto = CHECKPOINT_MAX_AUTO + 2;
    for (let i = 0; i < totalAuto; i++) {
      await storage.saveCheckpoint(makeCp(sid, `cp_auto_${i}`, i, true));
    }

    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    // 手动检查点全部保留
    for (let i = 0; i < 3; i++) {
      expect(files).toContain(`checkpoint-${sid}-cp_manual_${i}.json`);
    }
    // 自动检查点被收敛到总上限（50）减去手动占用的 3 个名额
    const autoCount = files.filter((f) => f.includes('cp_auto_')).length;
    expect(autoCount).toBe(CHECKPOINT_MAX_AUTO - 3);
  });

  it('数量未超上限时不删除任何检查点', async () => {
    for (let i = 0; i < CHECKPOINT_MAX_AUTO; i++) {
      await storage.saveCheckpoint(makeCp(sid, `cp_auto_${i}`, i, true));
    }
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(CHECKPOINT_MAX_AUTO);
  });
});
