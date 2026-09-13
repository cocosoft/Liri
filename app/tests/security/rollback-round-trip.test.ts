// MIT License
// Copyright (c) 2026 Liri
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
 * 文件回滚链路回归（O38 根因修复，2026-09-12）
 *
 * 守护的**具体缺陷**（修复前 4 条断言全部失败）：
 *   1. 撤销不还原：`backupPath` 无生产者（`FileOperationTracker` 只透传，调用方不传）
 *      + `hash` 语义倒置（写"操作前哈希"却被撤销守卫当作"轮末哈希"比对）→ 一律静默跳过
 *   2. 新建文件撤销后残留（操作前不存在却记作 modified）
 *   3. 撤销后无法重做（`afterBackupPath` 全仓只写不读 → 恒缺省）
 *   4. 无法还原时不上报（`failures: []`，上层无法感知"回滚其实没发生"）
 *
 * ⚠️ 环境隔离（落实台账 O36 的建议）：数据目录经 `LIRI_DATA_DIR` 指向临时目录，
 * **绝不触碰**真实 `~/.pyapp/data`。
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { RollbackIntegration } from '../../src/security/rollback/RollbackIntegration';
import type { FileOperation } from '../../src/security/rollback/FileOperationTracker';

let dataDir = '';
let prevDataDir: string | undefined;
let ws = '';
let seq = 0;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'o38-data-'));
  prevDataDir = process.env.LIRI_DATA_DIR;
  process.env.LIRI_DATA_DIR = dataDir;
  ws = await mkdtemp(join(tmpdir(), 'o38-ws-'));
});

afterAll(async () => {
  if (prevDataDir === undefined) delete process.env.LIRI_DATA_DIR;
  else process.env.LIRI_DATA_DIR = prevDataDir;
  await rm(dataDir, { recursive: true, force: true });
  await rm(ws, { recursive: true, force: true });
});

/** 建一轮：onRoundStart → onToolBeforeExecute → 写文件 → onRoundEnd */
async function runRound(
  tag: string,
  target: string,
  beforeWrite: string | null,
  afterWrite: string
): Promise<{ integ: RollbackIntegration; sid: string }> {
  const sid = `o38-${tag}-${Date.now()}-${seq++}`;
  const integ = new RollbackIntegration(sid);
  await integ.onRoundStart(sid, 1, [ws]);
  await integ.onToolBeforeExecute({ path: target, type: 'modified' } as FileOperation);
  if (beforeWrite !== null) await writeFile(target, beforeWrite, 'utf8');
  await writeFile(target, afterWrite, 'utf8');
  await integ.onRoundEnd('regression');
  return { integ, sid };
}

describe('回滚链路：写 → 回滚 → 终态（O38）', () => {
  it('modified 文件可还原，且快照哈希为轮末值', async () => {
    const target = join(ws, `a-${seq++}.txt`);
    await writeFile(target, 'V1\n', 'utf8');

    const { integ } = await runRound('undo', target, null, 'V2\n');
    const snap = await integ.getSnapshot(1);
    const change = snap!.changedFiles.find((c) => c.path === target)!;
    expect(change.backupPath).toBeTruthy();
    expect(change.hash).toBeTruthy();

    const undo = await integ.undoRound(1);
    expect(undo.failures).toEqual([]);
    expect(undo.revertedFiles).toBe(1);
    expect(await readFile(target, 'utf8')).toBe('V1\n');
  });

  it('操作前不存在的文件按"新建"记录，撤销后被删除', async () => {
    const target = join(ws, `b-${seq++}.txt`);

    const { integ } = await runRound('created', target, null, 'NEW\n');
    const snap = await integ.getSnapshot(1);
    expect(snap!.changedFiles.find((c) => c.path === target)!.type).toBe('created');

    const undo = await integ.undoRound(1);
    expect(undo.failures).toEqual([]);
    expect(undo.removedFiles).toBe(1);
    expect(existsSync(target)).toBe(false);
  });

  it('轮末之后被手改的文件不覆盖（用户修改保护）', async () => {
    const target = join(ws, `c-${seq++}.txt`);
    await writeFile(target, 'V1\n', 'utf8');

    const { integ } = await runRound('guard', target, null, 'V2\n');
    await writeFile(target, 'V3-user\n', 'utf8');

    const undo = await integ.undoRound(1);
    expect(undo.skippedUserModified).toBe(1);
    expect(undo.revertedFiles).toBe(0);
    expect(await readFile(target, 'utf8')).toBe('V3-user\n');
  });

  it('撤销后可重做回到改写后的版本', async () => {
    const target = join(ws, `d-${seq++}.txt`);
    await writeFile(target, 'V1\n', 'utf8');

    const { integ } = await runRound('redo', target, null, 'V2\n');
    await integ.undoRound(1);
    expect(await readFile(target, 'utf8')).toBe('V1\n');

    const redo = await integ.redoRound(1);
    expect(redo.failures).toEqual([]);
    expect(await readFile(target, 'utf8')).toBe('V2\n');
  });

  it('无备份的快照显式上报失败，不再静默跳过', async () => {
    const target = join(ws, `e-${seq++}.txt`);
    await writeFile(target, 'V1\n', 'utf8');
    const sid = `o38-nobackup-${Date.now()}`;

    // 模拟"旧快照 / 备份已被清理"：手工写入缺失 backupPath 的变更
    const { saveManifest, ensureSnapshotDirs } = await import(
      '../../src/security/rollback/SnapshotStorage'
    );
    await ensureSnapshotDirs(sid, 1);
    await saveManifest({
      roundId: 1,
      sessionId: sid,
      userMessageSummary: 'legacy snapshot without backup',
      createdAt: new Date().toISOString(),
      changedFiles: [{ path: target, type: 'modified' }],
      totalSize: 0,
      schemaVersion: 1,
      storeAfterVersion: false,
      scanStatus: 'complete',
      status: 'active',
    });

    const integ = new RollbackIntegration(sid);
    const undo = await integ.undoRound(1);
    expect(undo.failures.length).toBe(1);
    expect(undo.failures[0]).toContain('缺少操作前备份');
    expect(undo.success).toBe(false);
  });
});
