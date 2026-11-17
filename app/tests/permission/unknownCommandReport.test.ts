/**
 * 未知命令周报 CLI 的聚合口径（P2-A2，2026-11-17）。
 *
 * 只测**纯函数**（聚合 / 路径解析 / 参数），不读真实 home：
 * - 损坏行计入 `skipped` 且不中断；
 * - 同 head 累计 count，first/last 与最近样例逐条更新；
 * - `--since` / `--top` 生效；
 * - 路径优先级：显式 > env > `LIRI_HOME` 或 `~/.pyapp`。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  aggregateUnknownCommands,
  parseArgs,
  readUnknownCommandLogText,
  resolveSampleLogPath,
} from '../../../scripts/report-unknown-commands';

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0); // 2026-11-17T12:00:00Z
const DAY = 24 * 60 * 60 * 1000;

function line(head: string, at: number, surface = `${head} --x`): string {
  return JSON.stringify({ head, at, surface });
}

describe('aggregateUnknownCommands', () => {
  it('按 head 聚合：count/first/last/latestSurface 正确，损坏行计入 skipped', () => {
    const text = [
      line('liri-probe', NOW - 2 * DAY, 'liri-probe --list'),
      'not-json',
      line('liri-probe', NOW - DAY, 'liri-probe --depth 2'),
      line('archiver', NOW - 3 * DAY),
    ].join('\n');

    const r = aggregateUnknownCommands(text, { now: NOW });
    expect(r.skipped).toBe(1);
    expect(r.total).toBe(3);
    expect(r.rows.map((x) => x.head)).toEqual(['liri-probe', 'archiver']);
    const probe = r.rows[0]!;
    expect(probe.count).toBe(2);
    expect(probe.firstSeen).toBe(NOW - 2 * DAY);
    expect(probe.lastSeen).toBe(NOW - DAY);
    expect(probe.latestSurface).toBe('liri-probe --depth 2');
  });

  it('sinceDays 过滤旧样本；top 截断', () => {
    const text = [
      line('old-cli', NOW - 30 * DAY),
      line('new-cli', NOW - DAY),
      line('mid-cli', NOW - 2 * DAY),
    ].join('\n');

    const since = aggregateUnknownCommands(text, { now: NOW, sinceDays: 7 });
    expect(since.rows.map((x) => x.head)).toEqual(['new-cli', 'mid-cli']);
    expect(since.total).toBe(3);

    const top = aggregateUnknownCommands(text, { now: NOW, top: 1 });
    expect(top.rows).toHaveLength(1);
  });

  it('空文本 ⇒ 空报告（无异常）', () => {
    expect(aggregateUnknownCommands('', { now: NOW })).toEqual({
      rows: [],
      skipped: 0,
      total: 0,
    });
  });
});

describe('resolveSampleLogPath', () => {
  let prevLog: string | undefined;
  let prevHome: string | undefined;
  beforeEach(() => {
    prevLog = process.env.PERMISSION_UNKNOWN_COMMAND_LOG;
    prevHome = process.env.LIRI_HOME;
    delete process.env.PERMISSION_UNKNOWN_COMMAND_LOG;
    delete process.env.LIRI_HOME;
  });
  afterEach(() => {
    if (prevLog === undefined)
      delete process.env.PERMISSION_UNKNOWN_COMMAND_LOG;
    else process.env.PERMISSION_UNKNOWN_COMMAND_LOG = prevLog;
    if (prevHome === undefined) delete process.env.LIRI_HOME;
    else process.env.LIRI_HOME = prevHome;
  });

  it('显式 --log 优先于 env', () => {
    process.env.PERMISSION_UNKNOWN_COMMAND_LOG = '/env/log.jsonl';
    expect(resolveSampleLogPath('/cli/log.jsonl')).toBe('/cli/log.jsonl');
  });

  it('env 优先于默认；LIRI_HOME 覆盖默认根目录', () => {
    expect(resolveSampleLogPath()).toBe(
      join(homedir(), '.pyapp', 'data', 'permission', 'unknown-commands.jsonl')
    );
    process.env.LIRI_HOME = '/custom/home';
    expect(resolveSampleLogPath()).toBe(
      join('/custom/home', 'data', 'permission', 'unknown-commands.jsonl')
    );
    process.env.PERMISSION_UNKNOWN_COMMAND_LOG = '/env/log.jsonl';
    expect(resolveSampleLogPath()).toBe('/env/log.jsonl');
  });
});

describe('readUnknownCommandLogText（R4 轮转产物一并读取）', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'unknown-report-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('活跃文件 + 同目录轮转产物合并；不相关文件忽略', () => {
    const active = join(dir, 'unknown-commands.jsonl');
    writeFileSync(active, `${line('active-cli', NOW)}\n`);
    writeFileSync(
      join(dir, 'unknown-commands.2026-10.jsonl'),
      `${line('oct-cli', NOW - 30 * DAY)}\n`
    );
    writeFileSync(
      join(dir, 'unknown-commands.2026-10.1794000000000.jsonl'),
      `${line('oct-cli2', NOW - 29 * DAY)}\n`
    );
    writeFileSync(join(dir, 'other.jsonl'), `${line('other', NOW)}\n`);

    const report = aggregateUnknownCommands(readUnknownCommandLogText(active), {
      now: NOW,
    });
    expect(report.rows.map((r) => r.head).sort()).toEqual([
      'active-cli',
      'oct-cli',
      'oct-cli2',
    ]);
  });

  it('活跃文件不存在、仅有轮转产物 ⇒ 仍能读到样本', () => {
    const active = join(dir, 'unknown-commands.jsonl');
    writeFileSync(
      join(dir, 'unknown-commands.2026-10.jsonl'),
      `${line('oct-cli', NOW)}\n`
    );
    expect(readUnknownCommandLogText(active)).toContain('oct-cli');
  });
});

describe('parseArgs', () => {
  it('解析 --top/--since/--json/--log', () => {
    expect(
      parseArgs([
        '--top',
        '5',
        '--since',
        '7',
        '--json',
        '--log',
        '/tmp/x.jsonl',
      ])
    ).toEqual({ top: 5, sinceDays: 7, json: true, log: '/tmp/x.jsonl' });
  });

  it('非法 --top ⇒ 抛错（退出码 1 由 main 处理）', () => {
    expect(() => parseArgs(['--top', '0'])).toThrow('--top');
  });
});
