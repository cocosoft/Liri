// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * R5（2026-11-17）：未知命令采样摘要（周报 / 设置页 / 启动提示共用的单一实现）。
 *
 * 锁三件事：
 * 1. 口径：`headCount` = 窗口内不同命令名；`sampleCount` = 窗口内采样条数；
 * 2. 无样本 / 全部在窗口外 ⇒ `null`（不编造"本周 0 个"）；
 * 3. 读取：活跃文件 + 轮转产物一并聚合（R4 轮转后不丢上月样本）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildUnknownCommandDigest,
  formatUnknownCommandNotice,
  readUnknownCommandDigest,
  summarizeUnknownCommandText,
} from '@openliri/infra/permission';

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function line(head: string, at: number, surface = `${head} --x`): string {
  return JSON.stringify({ head, at, surface });
}

let dir: string;
const savedLog = process.env.PERMISSION_UNKNOWN_COMMAND_LOG;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'unknown-digest-'));
});

afterEach(() => {
  if (savedLog === undefined) delete process.env.PERMISSION_UNKNOWN_COMMAND_LOG;
  else process.env.PERMISSION_UNKNOWN_COMMAND_LOG = savedLog;
  rmSync(dir, { recursive: true, force: true });
});

describe('R5：采样聚合口径', () => {
  it('windowTotal 只统计窗口内；rows 按次数降序', () => {
    const text = [
      line('old-cli', NOW - 30 * DAY),
      line('hot-cli', NOW - 2 * DAY),
      line('hot-cli', NOW - DAY, 'hot-cli --deep'),
      line('cold-cli', NOW - 3 * DAY),
    ].join('\n');

    const report = summarizeUnknownCommandText(text, {
      sinceDays: 7,
      now: NOW,
    });
    expect(report.total).toBe(4);
    expect(report.windowTotal).toBe(3);
    expect(report.rows.map((r) => r.head)).toEqual(['hot-cli', 'cold-cli']);
    expect(report.rows[0]!.count).toBe(2);
  });

  it('digest：headCount / sampleCount / topHeads', () => {
    const text = [
      line('a-cli', NOW - DAY),
      line('a-cli', NOW - DAY),
      line('b-cli', NOW - 2 * DAY),
    ].join('\n');

    const digest = buildUnknownCommandDigest(text, {
      sinceDays: 7,
      top: 5,
      now: NOW,
    });
    expect(digest).not.toBeNull();
    if (!digest) return;
    expect(digest.headCount).toBe(2);
    expect(digest.sampleCount).toBe(3);
    expect(digest.sinceDays).toBe(7);
    expect(digest.topHeads.map((r) => r.head)).toEqual(['a-cli', 'b-cli']);
  });

  it('空文本 / 全部在窗口外 ⇒ null（不编造 0 值）', () => {
    expect(
      buildUnknownCommandDigest('', { sinceDays: 7, now: NOW })
    ).toBeNull();
    expect(
      buildUnknownCommandDigest(line('old', NOW - 30 * DAY), {
        sinceDays: 7,
        now: NOW,
      })
    ).toBeNull();
  });

  it('启动提示文案：无样本 ⇒ null；有样本 ⇒ 含 N / M / 最多命令名 / 跳转提示', () => {
    expect(formatUnknownCommandNotice(null)).toBeNull();
    const digest = buildUnknownCommandDigest(
      [line('a-cli', NOW), line('a-cli', NOW), line('b-cli', NOW)].join('\n'),
      { sinceDays: 7, now: NOW }
    );
    const text = formatUnknownCommandNotice(digest);
    expect(text).toContain('2 个未收录命令');
    expect(text).toContain('3 次审批');
    expect(text).toContain('a-cli');
    expect(text).toContain('权限管理');
  });
});

describe('R5：读取（活跃文件 + 轮转产物）', () => {
  it('合并活跃文件与同目录轮转产物', () => {
    const active = join(dir, 'unknown-commands.jsonl');
    writeFileSync(active, `${line('new-cli', NOW)}\n`);
    writeFileSync(
      join(dir, 'unknown-commands.2026-11.jsonl'),
      `${line('peer-cli', NOW)}\n`
    );

    const digest = readUnknownCommandDigest({
      sinceDays: 7,
      top: 5,
      now: NOW,
      logPath: active,
    });
    expect(digest).not.toBeNull();
    if (!digest) return;
    expect(digest.headCount).toBe(2);
    expect(digest.topHeads.map((r) => r.head).sort()).toEqual([
      'new-cli',
      'peer-cli',
    ]);
  });

  it('文件不存在 ⇒ null（不是"0 个命令"）', () => {
    const digest = readUnknownCommandDigest({
      sinceDays: 7,
      now: NOW,
      logPath: join(dir, 'missing.jsonl'),
    });
    expect(digest).toBeNull();
  });
});
