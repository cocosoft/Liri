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
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FileCheckpointStorage,
  resetCheckpointEvictLogThrottleForTest,
} from '@modules/session/storage/FileCheckpointStorage';
import { getLogger } from '@openliri/infra/monitoring';
import { CHECKPOINT_MAX_AUTO } from '@modules/session/types/checkpoint';
import type { SessionCheckpoint } from '@modules/session/types/checkpoint';

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
    resetCheckpointEvictLogThrottleForTest();
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

  // P2-1（2026-11-04）：实测单窗口该 info 901 条 —— 淘汰本身是"每次写入都发生"的状态，
  // 每次都打会把唯一信号淹没；改为按会话每分钟放行一次（信号保留、条数受控）。
  it('P2-1：连续淘汰的 info 按会话限流（窗口内只放行 1 条）', async () => {
    const logger = getLogger('session:fileCheckpointStorage');
    const info = spyOn(logger, 'info');
    try {
      // 写满上限 + 3 个 ⇒ 后 3 次写入各触发一次淘汰
      const total = CHECKPOINT_MAX_AUTO + 3;
      for (let i = 0; i < total; i++) {
        await storage.saveCheckpoint(makeCp(sid, `cp_auto_${i}`, i, true));
      }

      const evictLogs = info.mock.calls.filter(
        (c) => c[0] === 'Enforced max checkpoints per session'
      );
      expect(evictLogs.length).toBe(1); // 3 次淘汰 ⇒ 1 条日志
      expect(evictLogs[0][1]).toMatchObject({
        sessionId: sid,
        limit: CHECKPOINT_MAX_AUTO,
        removed: 1,
      });
    } finally {
      info.mockRestore();
    }
  });

  it('P2-1：限流按 sessionId 分键（不同会话互不压制）', async () => {
    const logger = getLogger('session:fileCheckpointStorage');
    const info = spyOn(logger, 'info');
    try {
      // A 会话先淘汰一次（放行）
      for (let i = 0; i <= CHECKPOINT_MAX_AUTO; i++) {
        await storage.saveCheckpoint(makeCp('sess_a', `a_${i}`, i, true));
      }
      // B 会话随后淘汰一次（应独立放行，不受 A 的窗口影响）
      for (let i = 0; i <= CHECKPOINT_MAX_AUTO; i++) {
        await storage.saveCheckpoint(makeCp('sess_b', `b_${i}`, i, true));
      }

      const sessions = info.mock.calls
        .filter((c) => c[0] === 'Enforced max checkpoints per session')
        .map((c) => (c[1] as { sessionId: string }).sessionId);
      expect(sessions).toEqual(['sess_a', 'sess_b']);
    } finally {
      info.mockRestore();
    }
  });

  // A4（2026-11-05）：原实现每次写入都 `readdir` + 读取全部检查点文件（~50 个），
  // 真机单窗口 901 次淘汰 ⇒ 数万次无谓文件读。改为「首次按需建索引，之后增量维护」。
  it('A4：索引按需建立 —— 同一会话只在首次写入时扫描目录', async () => {
    const load = spyOn(storage, 'loadCheckpoints');
    try {
      for (let i = 0; i < 5; i++) {
        await storage.saveCheckpoint(makeCp(sid, `cp_idx_${i}`, i, true));
      }
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      load.mockRestore();
    }
  });

  it('A4：deleteSessionCheckpoints 后索引失效 ⇒ 下次写入重新扫描', async () => {
    await storage.saveCheckpoint(makeCp(sid, 'cp_before', 1, true));
    await storage.deleteSessionCheckpoints(sid);

    const load = spyOn(storage, 'loadCheckpoints');
    try {
      await storage.saveCheckpoint(makeCp(sid, 'cp_after', 2, true));
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      load.mockRestore();
    }
  });

  it('A4：文件被外部按龄清理后淘汰不抛错，数量仍收敛到上限', async () => {
    for (let i = 0; i < CHECKPOINT_MAX_AUTO + 1; i++) {
      await storage.saveCheckpoint(makeCp(sid, `cp_ext_${i}`, i, true));
    }
    // 模拟制品保留绕过索引删掉「下一个将被淘汰」的文件
    rmSync(join(dir, `checkpoint-${sid}-cp_ext_1.json`), { force: true });

    await expect(
      storage.saveCheckpoint(makeCp(sid, 'cp_ext_new', 999, true))
    ).resolves.toBeUndefined();

    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(CHECKPOINT_MAX_AUTO);
  });
});
