/**
 * 执行域「原生状态 → 四原语」**纯映射**测试（状态机规范管理方案 阶段 4，2026-10-12）。
 *
 * 锁三件事：
 * ① **穷尽性**：8 个原生状态全部可投影（`Record<ExecutionStatus, …>` 的编译期保证 + 运行时抽样）；
 * ② **与域内既有判定同界**（防两处分类漂移）：`isTerminalStatus ⇒ SETTLED`、`isActiveStatus ⇒ RUNNING`；
 * ③ **如实锁"当前不可达"**：`SUSPENDED` **不在**投影像集内（预算挂起未实现 ⇒ 待方案阶段 5）。
 */

import { describe, expect, it } from 'bun:test';
import {
  EXECUTION_STATUSES,
  isActiveStatus,
  isTerminalStatus,
  projectExecutionStatus,
  type ExecutionStatus,
} from '../../src/execution/index.js';
import {
  EXECUTION_PRIMITIVES,
  type ExecutionPrimitive,
} from '../../src/state/engine/projectionBroker.js';

describe('执行域四原语投影（阶段 4 / 4.1）', () => {
  it('8 个原生状态全部可投影，且取值必属四原语', () => {
    expect(EXECUTION_STATUSES.length).toBe(8);
    for (const status of EXECUTION_STATUSES) {
      const primitive = projectExecutionStatus(status);
      expect(EXECUTION_PRIMITIVES).toContain(primitive);
    }
  });

  it('逐态映射：QUEUED→PREPARED；在飞 3 态→RUNNING；终态 4 态→SETTLED', () => {
    expect(projectExecutionStatus('QUEUED')).toBe('PREPARED');

    for (const active of [
      'RUNNING',
      'WAITING_USER',
      'CANCEL_REQUESTED',
    ] as const) {
      expect(projectExecutionStatus(active)).toBe('RUNNING');
    }

    for (const settled of [
      'CANCELLED',
      'COMPLETED',
      'FAILED',
      'STALE',
    ] as const) {
      expect(projectExecutionStatus(settled)).toBe('SETTLED');
    }
  });

  it('与域内既有判定**同界**（防分类漂移）', () => {
    for (const status of EXECUTION_STATUSES) {
      const primitive = projectExecutionStatus(status);
      if (isTerminalStatus(status)) {
        expect(primitive).toBe('SETTLED');
      }
      if (isActiveStatus(status)) {
        expect(primitive).toBe('RUNNING');
      }
      // 既非终态亦非活跃 ⇒ 只应是 QUEUED（唯一的"已就绪未启动"态）
      if (!isTerminalStatus(status) && !isActiveStatus(status)) {
        expect(status).toBe('QUEUED');
        expect(primitive).toBe('PREPARED');
      }
    }
  });

  it('WAITING_USER **不**投成 SUSPENDED（SUSPENDED=预算挂起，尚未实现）', () => {
    expect(projectExecutionStatus('WAITING_USER')).not.toBe('SUSPENDED');
  });

  it('如实锁"当前不可达"：SUSPENDED 不在投影像集内（待阶段 5 接入）', () => {
    const image = new Set<ExecutionPrimitive>(
      EXECUTION_STATUSES.map((s: ExecutionStatus) => projectExecutionStatus(s))
    );
    expect([...image].sort()).toEqual(['PREPARED', 'RUNNING', 'SETTLED']);
    expect(image.has('SUSPENDED')).toBe(false);
  });
});
