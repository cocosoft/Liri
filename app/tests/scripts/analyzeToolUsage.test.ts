/**
 * P0-0（2026-10-30）：`analyze-tool-usage` —— 工具使用取证脚本的回归锁。
 *
 * 契约：
 * - 别名归并（`read`/`read_file`/`read_me` → `file_read`；`shell` → `bash`）——
 *   实测这些旧名仍在被真实调用，不归并会误判成"另一个工具"；
 * - 「从未调用」= 注册清单 − 已调用（用于**候选排序**，不是删除依据）；
 * - 单轮披露快照取**最大**的一帧（`context/model-input` 的 `data.tools.schemas`）；
 * - 无样本时如实返回 0 / 打印"无样本"，不编造数据（CS06）。
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  canonicalToolName,
  collectEventLogs,
  formatReport,
  scanLogs,
  schemaSnapshotBytes,
  summarizeUsage,
} from '../../scripts/analyze-tool-usage';

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-tool-usage-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('canonicalToolName / summarizeUsage', () => {
  test('别名归并到规范名', () => {
    expect(canonicalToolName('read')).toBe('file_read');
    expect(canonicalToolName('read_file')).toBe('file_read');
    expect(canonicalToolName('read_me')).toBe('file_read');
    expect(canonicalToolName('shell')).toBe('bash');
    expect(canonicalToolName('session_lookup')).toBe('sessions');
    expect(canonicalToolName('file_read')).toBe('file_read');
  });

  test('汇总：次数降序、从未调用、未注册项', () => {
    const counts = new Map([
      ['read', 3],
      ['file_read', 2],
      ['grep', 5],
      ['legacy_thing', 1],
    ]);
    const summary = summarizeUsage(counts, ['file_read', 'grep', 'bash']);

    expect(summary.totalCalls).toBe(11);
    expect(summary.distinct).toBe(3);
    // 同次数按名字升序（稳定可复现）
    expect(summary.counts).toEqual([
      ['file_read', 5],
      ['grep', 5],
      ['legacy_thing', 1],
    ]);
    expect(summary.neverCalled).toEqual(['bash']);
    expect(summary.notRegistered).toEqual(['legacy_thing']);
  });
});

describe('schemaSnapshotBytes / collectEventLogs', () => {
  test('快照字节数 = JSON 的 UTF-8 长度之和', () => {
    expect(schemaSnapshotBytes([{ name: 'a' }])).toBe(
      Buffer.byteLength(JSON.stringify({ name: 'a' }), 'utf8')
    );
  });

  test('只收集名为 events.jsonl 的文件（排除 events.tail）', () => {
    const sessionDir = join(root, 'p1', 's1');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'events.jsonl'), '', 'utf8');
    writeFileSync(join(sessionDir, 'events.tail'), '', 'utf8');

    expect(collectEventLogs(root)).toEqual([join(sessionDir, 'events.jsonl')]);
  });
});

describe('scanLogs / formatReport', () => {
  function writeSession(lines: object[]): void {
    const dir = join(root, 'p1', 's1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'events.jsonl'),
      lines.map((l) => JSON.stringify(l)).join('\n'),
      'utf8'
    );
  }

  test('统计 tool_call（含别名）并取最大 schema 快照', async () => {
    writeSession([
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'assistant/tool_call', data: { name: 'file_read' } },
      { type: 'assistant/tool_call', data: { name: 'read' } },
      { type: 'assistant/tool_call', data: { name: 'grep' } },
      {
        type: 'context/model-input',
        data: { tools: { count: 2, schemas: [{ name: 'a' }, { name: 'b' }] } },
      },
      {
        type: 'context/model-input',
        data: { tools: { count: 1, schemas: [{ name: 'c' }] } },
      },
    ]);

    const scan = await scanLogs(collectEventLogs(root));
    const summary = summarizeUsage(scan.counts, ['file_read', 'grep', 'bash']);

    expect(scan.files).toBe(1);
    expect(summary.totalCalls).toBe(3);
    expect(summary.counts).toEqual([
      ['file_read', 2],
      ['grep', 1],
    ]);
    expect(summary.neverCalled).toEqual(['bash']);
    // 取"最大的一帧"（工具数最多），不是最后一帧
    expect(scan.schemaSnapshot?.count).toBe(2);

    const report = formatReport(scan, summary).join('\n');
    expect(report).toContain('工具调用：3 次');
    expect(report).toContain('最大单轮披露快照：2 个工具');
    expect(report).toContain('从未调用 ≠ 可删');
  });

  test('无样本 ⇒ 如实报"无样本"，不编造', async () => {
    writeSession([{ type: 'turn/start', data: { turn: 1 } }]);
    const scan = await scanLogs(collectEventLogs(root));
    const summary = summarizeUsage(scan.counts, ['file_read']);

    expect(summary.totalCalls).toBe(0);
    const report = formatReport(scan, summary).join('\n');
    expect(report).toContain('无样本');
  });

  test('坏行不影响解析（跳过）', async () => {
    const dir = join(root, 'p1', 's1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'events.jsonl'),
      [
        '{ not json',
        JSON.stringify({ type: 'assistant/tool_call', data: { name: 'grep' } }),
      ].join('\n'),
      'utf8'
    );

    const scan = await scanLogs(collectEventLogs(root));
    expect(summarizeUsage(scan.counts).totalCalls).toBe(1);
  });
});
