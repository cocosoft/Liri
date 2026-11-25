/**
 * 团队记忆同步审计报表（2N-7，2026-11-25）。
 *
 * 覆盖：空历史 ⇒ 零报表；多轮聚合（冲突 = 拉+推）/错误率；坏行跳过；limit 取最近 N 条。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildTeamSyncAuditReport,
  readTeamSyncHistory,
} from '@openliri/infra/memory/services/TeamSyncAuditReport';

const createdDirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'team-audit-'));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (!dir) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言
    }
  }
});

describe('buildTeamSyncAuditReport', () => {
  it('空历史 ⇒ 零报表（不伪造"从未出错"以外的结论）', () => {
    const report = buildTeamSyncAuditReport([]);
    expect(report.cycles).toBe(0);
    expect(report.conflicts).toBe(0);
    expect(report.lastAt).toBeNull();
    expect(report.errorRate).toBe(0);
    expect(report.recent).toEqual([]);
  });

  it('多轮聚合：汇总拉/推/冲突/错误，最近一轮取最后时间', () => {
    const report = buildTeamSyncAuditReport([
      {
        at: '2026-11-24T00:00:00.000Z',
        pulled: 2,
        pushed: 1,
        pullConflicts: 1,
        pushConflicts: 0,
        rejectedSecrets: 0,
        errors: 0,
      },
      {
        at: '2026-11-25T00:00:00.000Z',
        pulled: 1,
        pushed: 3,
        pullConflicts: 0,
        pushConflicts: 2,
        rejectedSecrets: 1,
        errors: 2,
      },
    ]);

    expect(report.cycles).toBe(2);
    expect(report.pulled).toBe(3);
    expect(report.pushed).toBe(4);
    expect(report.conflicts).toBe(3);
    expect(report.rejectedSecrets).toBe(1);
    expect(report.errors).toBe(2);
    expect(report.lastAt).toBe('2026-11-25T00:00:00.000Z');
    expect(report.errorRate).toBe(0.5);
    // recent 倒序（最新在前）
    expect(report.recent[0]?.at).toBe('2026-11-25T00:00:00.000Z');
  });
});

describe('readTeamSyncHistory', () => {
  it('文件缺失 ⇒ 空数组（首次同步前）', async () => {
    expect(await readTeamSyncHistory(makeDir())).toEqual([]);
  });

  it('坏行跳过；数值字段收敛；limit 取最近 N 条', async () => {
    const dir = makeDir();
    const lines = [
      JSON.stringify({ at: 't1', pulled: 1, pushed: 0, errors: 0 }),
      '{broken json',
      JSON.stringify({ at: 't2', pulled: '3', pushed: -1, errors: 'x' }),
      JSON.stringify({ at: 't3', pulled: 2.9, pushed: 1 }),
    ];
    writeFileSync(join(dir, 'sync-history.jsonl'), lines.join('\n') + '\n');

    const all = await readTeamSyncHistory(dir);
    expect(all).toHaveLength(3);
    expect(all[1]).toMatchObject({ pulled: 3, pushed: 0, errors: 0 });
    expect(all[2]).toMatchObject({ pulled: 2, pushed: 1 });

    const lastTwo = await readTeamSyncHistory(dir, 2);
    expect(lastTwo.map((r) => r.at)).toEqual(['t2', 't3']);
  });
});
