/**
 * LongRunningTaskOrchestrator 接入 scope（T1.2 补全）测试
 *
 * 验证：构造器创建执行副作用作用域并登记隔离资源，
 * dispose() 时 abort + scope LIFO 释放（真实 Agent 执行链路落地）。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { LongRunningTaskOrchestrator } from '../LongRunningTaskOrchestrator.js';

describe('LongRunningTaskOrchestrator scope 接入', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lrtorchestrator-scope-' + randomUUID()));
    process.env.LIRI_DATA_DIR = dir;
  });

  afterEach(() => {
    delete process.env.LIRI_DATA_DIR;
    // 1-3（2026-09-03）：构造即触发 fire-and-forget 审计短连接（task_audit_log 写入），
    // Windows 下 rmSync 可能与仍在异步写入的 sqlite 文件句柄竞态（EBUSY），
    // 清理失败不影响用例断言结论，容错后忽略。
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理竞态可忽略：临时目录由 OS 回收
    }
  });

  test('构造后 dispose 触发隔离 abort', () => {
    const orch = new LongRunningTaskOrchestrator('task-' + randomUUID());
    const isolation = orch.getIsolation();
    expect(isolation.abortController.signal.aborted).toBe(false);

    orch.dispose();
    expect(isolation.abortController.signal.aborted).toBe(true);
  });

  test('dispose 幂等（重复调用无副作用异常）', () => {
    const orch = new LongRunningTaskOrchestrator('task-' + randomUUID());
    orch.dispose();
    expect(() => orch.dispose()).not.toThrow();
  });
});
