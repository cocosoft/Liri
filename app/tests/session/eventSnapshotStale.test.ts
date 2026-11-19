// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 事件快照失效日志分级（2026-11-20）
 *
 * 真机 `app.log` 94 条 warn「事件快照过期，失效并回退磁盘读取」，且字段自相矛盾：
 * `snapshotTailSeq:88 / memoryTailSeq:90 / staleReason:"disk-behind"` —— 按判定实现，
 * 88≠90 时本应是 `snapshot-behind-memory`。真因是判定 `await` 读盘尾期间本实例继续 append，
 * 事后取值已推进。本模块只定级别与字段，判定/失效行为在宿主。
 */

import { describe, expect, it } from 'bun:test';
import {
  isBenignSnapshotDiskBehindRace,
  logSnapshotStale,
  SNAPSHOT_STALE_LOG_MESSAGE,
  type SnapshotStaleLogger,
} from '@modules/session/storage/eventSnapshotStale';

interface LogCall {
  level: 'debug' | 'warn';
  message: string;
  meta?: Record<string, unknown>;
}

function makeLogger(): SnapshotStaleLogger & { calls: LogCall[] } {
  const calls: LogCall[] = [];
  return {
    calls,
    debug: (message, meta) => calls.push({ level: 'debug', message, meta }),
    warn: (message, meta) => calls.push({ level: 'warn', message, meta }),
  };
}

describe('isBenignSnapshotDiskBehindRace', () => {
  it('disk-behind + 判定期间有 append ⇒ 可预期竞态', () => {
    expect(isBenignSnapshotDiskBehindRace('disk-behind', true)).toBe(true);
  });

  it('disk-behind 但期间无 append ⇒ 真·盘尾落后（需告警）', () => {
    expect(isBenignSnapshotDiskBehindRace('disk-behind', false)).toBe(false);
  });

  it('其他 staleReason 不受影响', () => {
    for (const reason of [
      'snapshot-behind-memory',
      'disk-ahead',
      'disk-read-error',
      'memory-not-init',
    ]) {
      expect(isBenignSnapshotDiskBehindRace(reason, true)).toBe(false);
    }
  });
});

describe('logSnapshotStale', () => {
  it('竞态（disk-behind + append）⇒ 只落 debug，字段标出竞态', () => {
    const logger = makeLogger();
    logSnapshotStale(logger, 'sess-1', 88, 88, 90, 'disk-behind');

    expect(logger.calls).toHaveLength(1);
    const call = logger.calls[0]!;
    expect(call.level).toBe('debug');
    expect(call.message).toBe(SNAPSHOT_STALE_LOG_MESSAGE);
    expect(call.meta).toMatchObject({
      sessionId: 'sess-1',
      snapshotTailSeq: 88,
      memoryTailSeq: 90,
      staleReason: 'disk-behind',
      appendedDuringCheck: true,
      tailSeqAtCheck: 88,
    });
  });

  it('真·盘尾落后（无 append）⇒ 保持 warn，且不出现竞态字段', () => {
    const logger = makeLogger();
    logSnapshotStale(logger, 'sess-2', 40, 50, 50, 'disk-behind');

    expect(logger.calls).toHaveLength(1);
    const call = logger.calls[0]!;
    expect(call.level).toBe('warn');
    expect(call.meta).toMatchObject({
      memoryTailSeq: 50,
      staleReason: 'disk-behind',
    });
    expect(call.meta).not.toHaveProperty('appendedDuringCheck');
    expect(call.meta).not.toHaveProperty('tailSeqAtCheck');
  });

  it('其他失效原因即使有 append 也保持 warn', () => {
    const logger = makeLogger();
    logSnapshotStale(logger, 'sess-3', 10, 10, 12, 'disk-ahead');

    expect(logger.calls[0]!.level).toBe('warn');
    expect(logger.calls[0]!.meta).toMatchObject({
      staleReason: 'disk-ahead',
      appendedDuringCheck: true,
      tailSeqAtCheck: 10,
    });
  });
});
