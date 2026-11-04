/**
 * P2-1（2026-11-04，《运行态问题排查与修复方案》）：日志噪声治理回归。
 *
 * 覆盖三条：
 *   ① 落盘单行：多行 message / stack 不再把一条日志拆成多行（实测 2.5h 内 1,063 行非 JSON 续行）；
 *   ② 高频 info 限流（`LogThrottle`）：按 key 每窗口一条，被压掉的条数以 `suppressed` 带出；
 *   ③ memProfile 限流判定（`decideMemProfileEmit`）：同一采样点窗口内只放行一次。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  Logger,
  flush,
  setGlobalConfigProvider,
  toSingleLineEntry,
} from '@openliri/infra/monitoring/logs/Logger';
import { LogThrottle } from '@openliri/infra/monitoring/logs/LogThrottle';
import { decideMemProfileEmit } from '@openliri/infra/monitoring/memProfile';

describe('P2-1：日志落盘单行', () => {
  it('多行 message / stack 被转义为单行（含 \\n 字面量）', () => {
    const line = toSingleLineEntry(
      '[t] [ERROR] [m] boom\nStack: A\n  at x()\n  at y()'
    );
    expect(line.includes('\n')).toBe(false);
    expect(line).toBe('[t] [ERROR] [m] boom\\nStack: A\\n  at x()\\n  at y()');
    expect(toSingleLineEntry('a\r\nb\rc')).toBe('a\\nb\\nc');
  });

  it('已经是单行的 JSON 条目不受影响', () => {
    const json = JSON.stringify({ message: 'a\nb' });
    expect(toSingleLineEntry(json)).toBe(json);
  });

  it('端到端：一条多行日志在文件里只占一行', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'log-single-line-'));
    const logPath = join(dir, 'app.log');
    try {
      setGlobalConfigProvider(() => ({
        fileOutput: true,
        logFile: logPath,
        format: 'text',
      }));
      const logger = new Logger({
        module: 'p2-1:test',
        format: 'text',
        consoleOutput: false,
      });
      logger.error('多行错误\n第二行\n第三行', { stack: 'a\nb' });
      logger.info('单行正常');
      await flush();

      const lines = readFileSync(logPath, 'utf-8')
        .split('\n')
        .filter((l) => l.trim().length > 0);
      expect(lines.length).toBe(2);
      expect(lines[0]).toContain('多行错误\\n第二行\\n第三行');
    } finally {
      setGlobalConfigProvider(() => ({}));
      await flush();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('P2-1：LogThrottle（高频 info 限流）', () => {
  it('同一 key 窗口内只放行一次，被压条数在下次放行时带出', () => {
    const throttle = new LogThrottle({ windowMs: 1000 });
    expect(throttle.tick('chat:configured', 1000).emit).toBe(true);
    for (let i = 1; i <= 5; i++) {
      expect(throttle.tick('chat:configured', 1000 + i * 10).emit).toBe(false);
    }
    const next = throttle.tick('chat:configured', 2000);
    expect(next.emit).toBe(true);
    expect(next.suppressed).toBe(5);
    // 带出后计数清零
    expect(throttle.tick('chat:configured', 3001).suppressed).toBe(0);
  });

  it('不同 key 互不影响', () => {
    const throttle = new LogThrottle({ windowMs: 1000 });
    expect(throttle.tick('chat:configured', 1000).emit).toBe(true);
    expect(throttle.tick('coding:configured', 1000).emit).toBe(true);
    expect(throttle.tick('chat:configured', 1200).emit).toBe(false);
  });

  it('key 达到上限时清理过期条目（防动态 key 无限增长）', () => {
    const throttle = new LogThrottle({ windowMs: 100, maxKeys: 2 });
    expect(throttle.tick('a', 0).emit).toBe(true);
    expect(throttle.tick('b', 0).emit).toBe(true);
    // 时间已过窗口 ⇒ 写入 c 前先清掉过期的 a/b
    expect(throttle.tick('c', 200).emit).toBe(true);
    // a 已过期 ⇒ 重新放行（若不是被清理，会判定仍在窗口内而抑制）
    expect(throttle.tick('a', 250).emit).toBe(true);
  });
});

describe('P2-1：memProfile 采样点限流', () => {
  it('同一采样点窗口内只放行一次，并累计 suppressed', () => {
    const store = new Map<string, { at: number; suppressed: number }>();
    expect(decideMemProfileEmit(store, 'context-build', 0, 5000)).toEqual({
      emit: true,
      suppressed: 0,
    });
    for (let i = 1; i <= 3; i++) {
      expect(
        decideMemProfileEmit(store, 'context-build', i * 1000, 5000)
      ).toEqual({
        emit: false,
        suppressed: 0,
      });
    }
    expect(decideMemProfileEmit(store, 'context-build', 5000, 5000)).toEqual({
      emit: true,
      suppressed: 3,
    });
  });

  it('不同采样点独立计时', () => {
    const store = new Map<string, { at: number; suppressed: number }>();
    decideMemProfileEmit(store, 'a', 0, 5000);
    decideMemProfileEmit(store, 'b', 0, 5000);
    expect(decideMemProfileEmit(store, 'a', 1000, 5000).emit).toBe(false);
    expect(decideMemProfileEmit(store, 'b', 1000, 5000).emit).toBe(false);
    expect(decideMemProfileEmit(store, 'a', 5000, 5000).emit).toBe(true);
  });
});
