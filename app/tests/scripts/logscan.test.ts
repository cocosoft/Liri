/**
 * LRO-01（2026-10-26）：日志取证工具 `scripts/logscan.ts` 的单测
 *
 * 该工具的核心价值是**跨轮转文件**取证 —— 2026-10-26 长程任务排查时，
 * 只读 `app.log` 导致"日志里什么都没有"的假阴性，真证据全在 `app.log.<ISO>` 里。
 * 所以这里重点断言：轮转文件会被扫到、窗口/关键词过滤正确、输出可定位（file:line）。
 */

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  fileCoverage,
  inTimeWindow,
  listLogFiles,
  matchesFilters,
  parseLogLine,
  parseLogScanArgs,
  scanFiles,
} from '../../scripts/logscan';

function logLine(
  timestamp: string,
  message: string,
  module = 'query:reactLoop',
  level = 'warn',
  metaDetail?: string
): string {
  return JSON.stringify({
    timestamp,
    level,
    module,
    message,
    // 真实日志里 `meta` 是**对象**（不是字符串）—— 测试也照此构造，否则截断逻辑测不到
    ...(metaDetail ? { meta: { detail: metaDetail } } : {}),
  });
}

function withTempLogs(files: Record<string, string[]>): {
  dir: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'logscan-'));
  for (const [name, lines] of Object.entries(files)) {
    writeFileSync(join(dir, name), lines.join('\n') + '\n', 'utf8');
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const BASE_OPTS = {
  from: undefined as string | undefined,
  to: undefined as string | undefined,
  greps: [] as string[],
  re: undefined as string | undefined,
  head: 100,
};

describe('parseLogScanArgs', () => {
  it('默认值 + `--grep` 以 | 或 , 拆分（OR 语义；Windows 只能用逗号）', () => {
    const o = parseLogScanArgs(['--grep', 'a|b | c'], { dir: '/logs' });
    expect(o.dir).toBe('/logs');
    expect(o.greps).toEqual(['a', 'b', 'c']);
    expect(o.head).toBe(60);
    expect(o.listFiles).toBe(false);

    const comma = parseLogScanArgs(['--grep', 'x,y'], { dir: '/logs' });
    expect(comma.greps).toEqual(['x', 'y']);
  });

  it('显式参数覆盖默认（file / from / to / head / raw / fail-on-empty）', () => {
    const o = parseLogScanArgs(
      [
        '--dir',
        'D:/l',
        '--file',
        'x.log',
        '--from',
        '04:00:00',
        '--to',
        '05:00:00',
        '--head',
        '5',
        '--raw',
        '--fail-on-empty',
      ],
      { dir: '/logs' }
    );
    expect(o).toMatchObject({
      dir: 'D:/l',
      file: 'x.log',
      from: '04:00:00',
      to: '05:00:00',
      head: 5,
      raw: true,
      failOnEmpty: true,
    });
  });
});

describe('inTimeWindow', () => {
  it('HH:mm:ss ⇒ 只比时刻（跨日期也命中）', () => {
    expect(
      inTimeWindow('2026-10-25T04:17:00.000Z', '04:00:00', '05:00:00')
    ).toBe(true);
    expect(
      inTimeWindow('2026-10-26T04:17:00.000Z', '04:00:00', '05:00:00')
    ).toBe(true);
    expect(
      inTimeWindow('2026-10-26T05:00:01.000Z', '04:00:00', '05:00:00')
    ).toBe(false);
  });

  it('ISO ⇒ 按绝对时间比较', () => {
    expect(
      inTimeWindow(
        '2026-10-26T04:17:00.000Z',
        '2026-10-26T04:00:00.000Z',
        '2026-10-26T05:00:00.000Z'
      )
    ).toBe(true);
    expect(
      inTimeWindow(
        '2026-10-25T04:17:00.000Z',
        '2026-10-26T04:00:00.000Z',
        '2026-10-26T05:00:00.000Z'
      )
    ).toBe(false);
  });

  it('省略边界 ⇒ 不设限', () => {
    expect(inTimeWindow('2026-10-26T04:17:00.000Z', undefined, undefined)).toBe(
      true
    );
  });
});

describe('matchesFilters', () => {
  it('greps 为 OR；re 额外要求命中（AND）', () => {
    const line = '{"message":"reActLoop:all-tools-failed"}';
    expect(matchesFilters(line, ['all-tools-failed'], null)).toBe(true);
    expect(
      matchesFilters(line, ['circuit_breaker', 'all-tools-failed'], null)
    ).toBe(true);
    expect(matchesFilters(line, ['circuit_breaker'], null)).toBe(false);
    // 注意大小写：日志里的模块名是 `reActLoop`（大写 A），正则按原样匹配
    expect(matchesFilters(line, ['all-tools-failed'], /reActLoop/)).toBe(true);
    expect(matchesFilters(line, ['all-tools-failed'], /permission/)).toBe(
      false
    );
  });
});

describe('parseLogLine', () => {
  it('解析 timestamp/level/module/message，并还原转义', () => {
    const rec = parseLogLine(
      logLine('2026-10-26T04:17:27.193Z', 'reActLoop:circuit_breaker triggered')
    );
    expect(rec).toMatchObject({
      timestamp: '2026-10-26T04:17:27.193Z',
      level: 'warn',
      module: 'query:reactLoop',
      message: 'reActLoop:circuit_breaker triggered',
    });
  });

  it('非 JSONL 行（堆栈/空行）返回 null', () => {
    expect(parseLogLine('')).toBeNull();
    expect(parseLogLine('    at foo (bar.ts:1:2)')).toBeNull();
  });

  it('meta 超长时截断（避免终端刷屏）', () => {
    const rec = parseLogLine(
      logLine('2026-10-26T04:17:27.193Z', 'm', 'mod', 'info', 'x'.repeat(300))
    );
    expect(rec?.meta?.endsWith('…')).toBe(true);
    expect((rec?.meta ?? '').length).toBeLessThanOrEqual(161);
  });
});

describe('listLogFiles（跨轮转的核心）', () => {
  it('扫到 app.log 与 app.log.<ISO>；轮转在前、当前文件最后；忽略无关文件', () => {
    const { dir, cleanup } = withTempLogs({
      'app.log': [logLine('2026-10-26T05:00:00.000Z', 'current')],
      'app.log.2026-10-26T05-49-26-792Z': [
        logLine('2026-10-26T04:17:27.193Z', 'rotated-b'),
      ],
      'app.log.2026-10-25T22-49-26-782Z': [
        logLine('2026-10-25T23:00:00.000Z', 'rotated-a'),
      ],
      'other.log': [logLine('2026-10-26T04:00:00.000Z', 'ignored')],
    });
    try {
      const files = listLogFiles(dir).map((f) => f.split(/[\\/]/).pop());
      expect(files).toEqual([
        'app.log.2026-10-25T22-49-26-782Z',
        'app.log.2026-10-26T05-49-26-792Z',
        'app.log',
      ]);
    } finally {
      cleanup();
    }
  });

  it('目录不存在 ⇒ 空数组（不抛）', () => {
    expect(listLogFiles(join(tmpdir(), 'definitely-not-exist-9f8e'))).toEqual(
      []
    );
  });
});

describe('scanFiles（命中 + 定位 + 截断）', () => {
  it('跨轮转文件命中，并给出 file:line（可回查）', () => {
    const { dir, cleanup } = withTempLogs({
      'app.log.2026-10-26T05-49-26-792Z': [
        logLine('2026-10-26T04:15:48.345Z', 'bash: security_gate_blocked'),
        '    at stack (x.ts:1:2)',
        logLine(
          '2026-10-26T04:17:27.193Z',
          'reActLoop:circuit_breaker triggered'
        ),
      ],
      'app.log': [
        logLine('2026-10-26T05:10:00.000Z', 'reActLoop:all-tools-failed'),
      ],
    });
    try {
      const hits = scanFiles(listLogFiles(dir), BASE_OPTS);
      expect(hits.length).toBe(3);
      expect(hits[0].record.message).toBe('bash: security_gate_blocked');
      expect(hits[0].line).toBe(1);
      expect(hits[2].file.endsWith('app.log')).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('时刻窗口 + 关键词：只命中失败窗口内的那两条', () => {
    const { dir, cleanup } = withTempLogs({
      'app.log.2026-10-26T05-49-26-792Z': [
        logLine('2026-10-26T04:15:47.000Z', 'reactToolLoop:onToolCall end'),
        logLine(
          '2026-10-26T04:17:27.193Z',
          'reActLoop:circuit_breaker triggered'
        ),
        logLine('2026-10-26T05:11:33.622Z', 'reActLoop:all-tools-failed'),
      ],
    });
    try {
      const hits = scanFiles(listLogFiles(dir), {
        ...BASE_OPTS,
        from: '04:17:00',
        to: '04:18:00',
        greps: ['circuit_breaker'],
      });
      expect(hits.length).toBe(1);
      expect(hits[0].record.message).toContain('circuit_breaker');
    } finally {
      cleanup();
    }
  });

  it('head 截断（跨文件累计）', () => {
    const { dir, cleanup } = withTempLogs({
      'app.log.2026-10-26T05-49-26-792Z': [
        logLine('2026-10-26T04:00:01.000Z', 'a'),
        logLine('2026-10-26T04:00:02.000Z', 'b'),
      ],
      'app.log': [logLine('2026-10-26T05:00:01.000Z', 'c')],
    });
    try {
      expect(
        scanFiles(listLogFiles(dir), { ...BASE_OPTS, head: 2 }).length
      ).toBe(2);
    } finally {
      cleanup();
    }
  });
});

describe('fileCoverage（--list-files 用）', () => {
  it('给出首末时间戳与字节数（用于确认"哪段区间落在哪个文件"）', () => {
    const { dir, cleanup } = withTempLogs({
      'app.log.2026-10-26T05-49-26-792Z': [
        logLine('2026-10-26T04:17:00.000Z', 'first'),
        logLine('2026-10-26T06:49:00.000Z', 'last'),
      ],
    });
    try {
      const [file] = listLogFiles(dir);
      const c = fileCoverage(file);
      expect(c.first).toBe('2026-10-26T04:17:00.000Z');
      expect(c.last).toBe('2026-10-26T06:49:00.000Z');
      expect(c.size).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });
});
