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
 * GAI-3（2026-10-05）：PDCA 检查点 SQLite 存储验收（spec §5 核心）
 *
 * - **并发原子性**：同 taskId 并发 `writePdcaCheckpoint` 写**不同字段** N 次
 *   ⇒ 最终字段**合并完整**（无覆盖丢失）——根治旧"整文件读改写"的 RMW 竞态；
 * - **迁移幂等**：造 `<dir>/<taskId>.json` ⇒ `migratePdcaCheckpointsFromJson()` 导入
 *   ⇒ 重复调用**不重复导入**（且不删原 JSON）。
 *
 * 以 `LIRI_DATA_DIR` 隔离临时库（`resolveDbPath()` 读它），避免污染真实 app.db。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dataDir = mkdtempSync(join(tmpdir(), 'pdca-sqlite-'));
process.env.LIRI_DATA_DIR = dataDir;
const pdcaDir = join(dataDir, 'pdca');

const {
  writePdcaCheckpoint,
  readPdcaCheckpoint,
  migratePdcaCheckpointsFromJson,
  closePdcaCheckpointStore,
} = await import('../../src/tasks/PdcaWorkItemBridge');

afterAll(() => {
  closePdcaCheckpointStore();
  delete process.env.LIRI_DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('GAI-3：PDCA 检查点 SQLite（原子性 / 迁移幂等）', () => {
  it('并发合并写：同 taskId 并发写不同字段 N 次 ⇒ 字段合并完整（无覆盖丢失）', async () => {
    const taskId = 'ck_concurrent';
    const N = 50;

    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        writePdcaCheckpoint(taskId, { taskId, [`field_${i}`]: i })
      )
    );

    const ck = (await readPdcaCheckpoint(taskId)) as Record<string, unknown>;
    expect(ck).not.toBeNull();
    // 全部字段合并完整（旧 RMW 实现下会相互覆盖 → 只留最后 1 个）
    for (let i = 0; i < N; i++) {
      expect(ck[`field_${i}`]).toBe(i);
    }
    expect(ck.taskId).toBe(taskId);
    expect(typeof ck.updatedAt).toBe('string');
  });

  it('迁移幂等：造 JSON ⇒ 导入 ⇒ 重复调用不重复导入', async () => {
    mkdirSync(pdcaDir, { recursive: true });
    const taskId = 'ck_migrate_1';
    const file = join(pdcaDir, `${taskId}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        { taskId, status: 'running', phase: 'execute', note: 'migrated' },
        null,
        2
      ),
      'utf-8'
    );

    const first = await migratePdcaCheckpointsFromJson(pdcaDir);
    expect(first.imported).toBe(1);
    expect(first.skipped).toBe(0);
    expect(first.errors).toBe(0);
    expect(await readPdcaCheckpoint(taskId)).toMatchObject({
      note: 'migrated',
      phase: 'execute',
    });

    const second = await migratePdcaCheckpointsFromJson(pdcaDir);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.errors).toBe(0);

    // 迁移不删原 JSON（可回滚）
    expect(existsSync(file)).toBe(true);
  });
});
