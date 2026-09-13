/**
 * TraceWriter 单元测试
 *
 * 覆盖 v5 方案 3.3：
 * - readRecordsByDate / readAllRecords 按 id 去重（completed 覆盖 pending）
 * - 去重后按 timestamp 降序
 * - doWrite 按 record.timestamp（发起时刻）选日期文件，而非写入时刻
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TraceWriter } from '../TraceWriter';
import type { TraceRecord } from '../../types';

function makeRecord(
  id: string,
  timestamp: string,
  phase?: 'pending' | 'completed'
): TraceRecord {
  return {
    id,
    timestamp,
    turn: 1,
    durationMs: phase === 'pending' ? 0 : 100,
    upstreamBaseUrl: 'https://api.example.com',
    phase,
    request: {
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {},
      body: { model: 'test-model' },
    },
    response: {
      status: phase === 'pending' ? 0 : 200,
      headers: {},
      body: null,
    },
  };
}

let tmpDir: string;
let writer: TraceWriter;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracewriter-test-'));
  writer = new TraceWriter(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('TraceWriter 按 id 去重（v5 方案 3.3）', () => {
  test('同 id pending+completed 两行 → 读取去重后 1 条（completed）', async () => {
    const ts = '2026-08-15T00:00:00.000Z';
    await writer.write(makeRecord('req_a', ts, 'pending'));
    await writer.write(makeRecord('req_a', ts, 'completed'));

    const records = writer.readAllRecords();
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('req_a');
    expect(records[0].phase).toBe('completed');
  });

  test('readRecordsByDate 同样去重', async () => {
    const ts = '2026-08-15T00:00:00.000Z';
    await writer.write(makeRecord('req_a', ts, 'pending'));
    await writer.write(makeRecord('req_a', ts, 'completed'));

    const records = writer.readRecordsByDate('2026-08-15');
    expect(records).toHaveLength(1);
    expect(records[0].phase).toBe('completed');
  });

  test('去重后按 timestamp 降序', async () => {
    await writer.write(
      makeRecord('req_old', '2026-08-15T00:00:00.000Z', 'completed')
    );
    await writer.write(
      makeRecord('req_new', '2026-08-15T00:05:00.000Z', 'completed')
    );

    const records = writer.readAllRecords();
    expect(records.map((r) => r.id)).toEqual(['req_new', 'req_old']);
  });

  test('纯 pending（进程崩溃场景）保留且 phase=pending', async () => {
    const ts = '2026-08-15T00:00:00.000Z';
    await writer.write(makeRecord('req_a', ts, 'pending'));

    const records = writer.readAllRecords();
    expect(records).toHaveLength(1);
    expect(records[0].phase).toBe('pending');
  });
});

describe('TraceWriter doWrite 按 timestamp 选文件（v5 方案 3.3 跨天修复）', () => {
  test('跨午夜：pending 与 completed 落同一日期文件（发起时刻日期）', async () => {
    // 发起于 08-15 23:59:59（timestamp 即发起时刻），若按写入时刻完成于 08-16 00:00:01
    const ts = '2026-08-15T23:59:59.000Z';
    await writer.write(makeRecord('req_x', ts, 'pending'));
    await writer.write(makeRecord('req_x', ts, 'completed'));

    // 应落在 trace_2026-08-15.jsonl（timestamp 日期），而非 08-16
    expect(fs.existsSync(path.join(tmpDir, 'trace_2026-08-15.jsonl'))).toBe(
      true
    );
    expect(fs.existsSync(path.join(tmpDir, 'trace_2026-08-16.jsonl'))).toBe(
      false
    );

    const byDate = writer.readRecordsByDate('2026-08-15');
    expect(byDate).toHaveLength(1);
    expect(byDate[0].phase).toBe('completed');
  });

  test('普通请求写入文件日期与 timestamp 一致', async () => {
    const ts = '2026-08-14T10:00:00.000Z';
    await writer.write(makeRecord('req_y', ts, 'completed'));

    expect(fs.existsSync(path.join(tmpDir, 'trace_2026-08-14.jsonl'))).toBe(
      true
    );
    const records = writer.readRecordsByDate('2026-08-14');
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('req_y');
  });
});
