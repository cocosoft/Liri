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
 * PDCA 检查点**留存清理**（2026-09-29 台账「另案 ⑥ · 留存策略」）。
 *
 * 策略（用户裁定）：**启动时自动清理 / 仅终态且超期 / 保留 30 天**。
 * 终态 = `phase ∈ PDCA_TERMINAL_PHASES` **或** `status ∈ PDCA_TERMINAL_STATUSES`；
 * 非终态（`started`/`running`/`plan_pending`/`stage_awaiting_approval` 等）**一律保留**。
 *
 * ⚠️ **隔离必须用 `LIRI_DATA_DIR`**：`resolveDataDir()` 先读它，而 `LIRI_HOME` 会被
 * `setUserDataDirOverride()` 盖过 —— 只设 `LIRI_HOME` 会读写**真实**数据目录（教训见台账「另案 ⑤」）。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  utimesSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dataDir = mkdtempSync(join(tmpdir(), 'pdca-retention-'));
process.env.LIRI_DATA_DIR = dataDir;
process.env.LIRI_HOME = dataDir;

const pdcaDir = join(dataDir, 'pdca');

const {
  prunePdcaCheckpoints,
  listPdcaCheckpoints,
  PDCA_CHECKPOINT_RETENTION_DAYS,
} = await import('../../src/tasks/PdcaWorkItemBridge');

const DAY_MS = 24 * 60 * 60 * 1000;
const OLD_ISO = new Date(Date.now() - 40 * DAY_MS).toISOString();
const FRESH_ISO = new Date().toISOString();
const OLD_MTIME_SEC = (Date.now() - 40 * DAY_MS) / 1000;

/** 在隔离目录写一份检查点（filename == taskId，与生产写入路径一致） */
function writeCk(taskId: string, body: Record<string, unknown>): string {
  mkdirSync(pdcaDir, { recursive: true });
  const filePath = join(pdcaDir, `${taskId}.json`);
  writeFileSync(
    filePath,
    JSON.stringify({ taskId, ...body }, null, 2),
    'utf-8'
  );
  return filePath;
}

const exists = (taskId: string) => existsSync(join(pdcaDir, `${taskId}.json`));

describe('PDCA 检查点留存清理（另案 ⑥ · 留存）', () => {
  it('默认留存 30 天（用户裁定）', () => {
    expect(PDCA_CHECKPOINT_RETENTION_DAYS).toBe(30);
  });

  it('终态 + 超期 ⇒ 删除；非终态 / 未超期 ⇒ 保留', () => {
    writeCk('r_done_old', { status: 'completed', updatedAt: OLD_ISO });
    writeCk('r_abort_old', { phase: 'abort', updatedAt: OLD_ISO });
    writeCk('r_failed_old', { status: 'failed', updatedAt: OLD_ISO });
    writeCk('r_done_fresh', { status: 'completed', updatedAt: FRESH_ISO });
    writeCk('r_running_old', { status: 'running', updatedAt: OLD_ISO });
    writeCk('r_started_old', { status: 'started', updatedAt: OLD_ISO });
    // 待审批（非终态）必须留到用户处理 —— 与启动扫描的同类豁免一致
    writeCk('r_await_old', {
      phase: 'stage_awaiting_approval',
      status: 'started',
      updatedAt: OLD_ISO,
    });
    writeCk('r_plan_pending_old', {
      phase: 'plan_pending',
      status: 'started',
      updatedAt: OLD_ISO,
    });

    const r = prunePdcaCheckpoints();

    // 删除：3 个"终态 + 超期"
    expect(exists('r_done_old')).toBe(false);
    expect(exists('r_abort_old')).toBe(false);
    expect(exists('r_failed_old')).toBe(false);
    // 保留：终态但新鲜
    expect(exists('r_done_fresh')).toBe(true);
    // 保留：非终态（含待审批）
    expect(exists('r_running_old')).toBe(true);
    expect(exists('r_started_old')).toBe(true);
    expect(exists('r_await_old')).toBe(true);
    expect(exists('r_plan_pending_old')).toBe(true);

    expect(r.scanned).toBe(8);
    expect(r.pruned).toBe(3);
    expect(r.keptFresh).toBe(1);
    expect(r.keptActive).toBe(4);
    expect(r.errors).toBe(0);
  });

  it('`updatedAt` 缺失 ⇒ 回退文件 mtime（老 mtime 的终态仍被删）', () => {
    const filePath = writeCk('r_no_ts_old', { status: 'completed' });
    utimesSync(filePath, OLD_MTIME_SEC, OLD_MTIME_SEC);

    const r = prunePdcaCheckpoints();

    expect(exists('r_no_ts_old')).toBe(false);
    expect(r.pruned).toBe(1);
  });

  it('`maxAgeDays` 参数生效：传 0 时连"新鲜"终态也删（非终态仍保留）', () => {
    writeCk('r_zero_target', { status: 'completed', updatedAt: FRESH_ISO });

    const r = prunePdcaCheckpoints(0);

    expect(exists('r_zero_target')).toBe(false);
    expect(r.pruned).toBeGreaterThanOrEqual(1);
    // 非终态不受天数影响
    expect(exists('r_running_old')).toBe(true);
    expect(exists('r_await_old')).toBe(true);
  });

  it('超期"孤儿"（非终态、非活跃、非待审批）⇒ 删除；在跑 / 待审批 ⇒ 保留', () => {
    // 孤儿（实测真实目录里 8/16 的 d2-test-* / d5-replan-* 即此类）
    writeCk('o_review_old', { phase: 'review', updatedAt: OLD_ISO });
    writeCk('o_plan_old', { phase: 'plan', status: '', updatedAt: OLD_ISO });
    // 未超期 ⇒ 无论形态一律保留
    writeCk('o_review_fresh', { phase: 'review', updatedAt: FRESH_ISO });
    // 在跑（活跃 status）⇒ 保留
    writeCk('o_running_old', {
      phase: 'execute',
      status: 'running',
      updatedAt: OLD_ISO,
    });
    writeCk('o_started_old', {
      phase: 'plan',
      status: 'started',
      updatedAt: OLD_ISO,
    });
    // 待审批（活跃 status + 豁免 phase）⇒ 保留
    writeCk('o_await_old', {
      phase: 'plan_pending',
      status: 'started',
      updatedAt: OLD_ISO,
    });
    // 待审批 phase 但 status 缺失 ⇒ 仍保留（豁免按 phase 判定）
    writeCk('o_await_nostatus_old', {
      phase: 'stage_awaiting_approval',
      updatedAt: OLD_ISO,
    });

    const r = prunePdcaCheckpoints();

    expect(exists('o_review_old')).toBe(false);
    expect(exists('o_plan_old')).toBe(false);
    expect(exists('o_review_fresh')).toBe(true);
    expect(exists('o_running_old')).toBe(true);
    expect(exists('o_started_old')).toBe(true);
    expect(exists('o_await_old')).toBe(true);
    expect(exists('o_await_nostatus_old')).toBe(true);

    expect(r.prunedOrphan).toBe(2);
    expect(r.prunedTerminal).toBe(0);
  });

  it('删除后索引同步：`listPdcaCheckpoints()` 不再返回已删项', () => {
    const ids = listPdcaCheckpoints().map((ck) => ck.taskId);
    expect(ids).not.toContain('r_done_old');
    expect(ids).not.toContain('r_failed_old');
    expect(ids).toContain('r_running_old');
  });

  afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });
});
