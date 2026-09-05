// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * cancelSessionPdcaCheckpoints 单测（阶段一 4.2-5，2026-09-05）
 *
 * 会话删除/清空联动终态化：仅把「该会话的非终态 checkpoint」置为 abort/cancelled；
 * 终态（completed/failed/abort）与无 sessionId 归属、其他会话的条目一律不动。
 * 隔离 LIRI_HOME（临时目录）。
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

process.env.LIRI_HOME = mkdtempSync(join(tmpdir(), 'pdca-cancel-session-'));

const { readPdcaCheckpoint, writePdcaCheckpoint, listPdcaCheckpoints } =
  await import('../../src/tasks/PdcaWorkItemBridge');
const { cancelSessionPdcaCheckpoints } =
  await import('../../src/tasks/PdcaWorkItemBridge');

// ── 预写 5 个 checkpoint ─────────────────────────────
// sess_s：running（应取消）/ completed（保留）/ failed（保留）
// 其他会话：running（保留，不越界）
writePdcaCheckpoint('pdca_sess_s_run', {
  taskId: 'pdca_sess_s_run',
  sessionId: 'sess_s',
  phase: 'execute',
  status: 'running',
});
writePdcaCheckpoint('pdca_sess_s_done', {
  taskId: 'pdca_sess_s_done',
  sessionId: 'sess_s',
  phase: 'completed',
  status: 'completed',
});
writePdcaCheckpoint('pdca_sess_s_fail', {
  taskId: 'pdca_sess_s_fail',
  sessionId: 'sess_s',
  phase: 'failed',
  status: 'failed',
});
writePdcaCheckpoint('pdca_other_run', {
  taskId: 'pdca_other_run',
  sessionId: 'sess_other',
  phase: 'execute',
  status: 'running',
});

describe('cancelSessionPdcaCheckpoints（4.2-5）', () => {
  test('仅把该会话非终态 checkpoint 置 abort/cancelled，终态与其他会话不动', () => {
    const updated = cancelSessionPdcaCheckpoints('sess_s');

    expect(updated).toBe(1);
    const cancelled = readPdcaCheckpoint('pdca_sess_s_run');
    expect(cancelled?.phase).toBe('abort');
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.cancelledReason).toBe('session-deleted');
    expect(typeof cancelled?.cancelledAt).toBe('string');

    // 终态不动
    const done = readPdcaCheckpoint('pdca_sess_s_done');
    expect(done?.status).toBe('completed');
    expect(done?.phase).toBe('completed');
    const fail = readPdcaCheckpoint('pdca_sess_s_fail');
    expect(fail?.status).toBe('failed');

    // 其他会话 running 不动（不越界）
    const other = readPdcaCheckpoint('pdca_other_run');
    expect(other?.status).toBe('running');
    expect(other?.phase).toBe('execute');
  });

  test('幂等：再次调用不重复计、不覆盖终态', () => {
    const again = cancelSessionPdcaCheckpoints('sess_s');
    expect(again).toBe(0);
    const cancelled = readPdcaCheckpoint('pdca_sess_s_run');
    expect(cancelled?.phase).toBe('abort');
  });

  test('list 层可见 cancelled 终态条目（无内存 orchestrator 时）', () => {
    const items = listPdcaCheckpoints();
    const target = items.find((c) => c.taskId === 'pdca_sess_s_run');
    expect(target?.status).toBe('cancelled');
    expect(target?.phase).toBe('abort');
  });
});
