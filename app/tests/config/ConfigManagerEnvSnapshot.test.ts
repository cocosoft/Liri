/**
 * R05-012 收敛（2026-09-24）：`ConfigManager.envSnapshot()` —— env 统一出入口的"批量面"。
 *
 * 背景：`ToolExecutionService` 需要把**整份 env** 透传给工具执行上下文（供子进程继承），
 * 原实现直接引用 `process.env`（活引用：工具可经它改写进程环境）。现经统一出入口取快照。
 */

import { describe, it, expect } from 'bun:test';
import { configManager } from '@modules/config';

describe('ConfigManager.envSnapshot（env 统一入口的批量面）', () => {
  it('包含当前 env 值，且为**浅拷贝**（改写不回灌进程环境）', () => {
    process.env.LIRI_ENV_SNAPSHOT_PROBE = 'v1';
    try {
      const snap = configManager.envSnapshot();
      expect(snap.LIRI_ENV_SNAPSHOT_PROBE).toBe('v1');

      // 活引用会写穿到 process.env；快照不会 —— 这是本次收敛带来的实质改进
      snap.LIRI_ENV_SNAPSHOT_PROBE = 'mutated';
      expect(process.env.LIRI_ENV_SNAPSHOT_PROBE).toBe('v1');
    } finally {
      delete process.env.LIRI_ENV_SNAPSHOT_PROBE;
    }
  });

  it('值域恒为 string（跳过 undefined 项）', () => {
    const snap = configManager.envSnapshot();
    for (const value of Object.values(snap)) {
      expect(typeof value).toBe('string');
    }
  });
});
