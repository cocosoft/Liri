// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2（2026-11-04，方案 §3.3）：会话**活跃长程任务**登记表 + 任务档审批回收。
 *
 * 要防的漂移：
 *   ① 阶段链里同时跑多个任务时，"当前任务"取错 ⇒ 任务档放行错配；
 *   ② 任务终态/中止只摘登记、不回收放行记录 ⇒ 任务 id 复用时误命中。
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  getActiveTaskIdForSession,
  markTaskActive,
  markTaskInactive,
  releaseTaskScope,
  resetTaskScopeRegistry,
} from '../../src/tasks/lro/taskScopeRegistry.js';
import {
  getApprovedCommandRegistry,
  hashCommand,
} from '@openliri/infra/permission';

describe('taskScopeRegistry', () => {
  beforeEach(() => {
    resetTaskScopeRegistry();
  });
  afterEach(() => {
    resetTaskScopeRegistry();
  });

  it('登记后取当前任务；重复登记幂等', () => {
    markTaskActive('s1', 'task-A');
    expect(getActiveTaskIdForSession('s1')).toBe('task-A');
    markTaskActive('s1', 'task-A');
    expect(getActiveTaskIdForSession('s1')).toBe('task-A');
    expect(getActiveTaskIdForSession('s2')).toBeUndefined();
  });

  it('阶段链：同会话多任务取最后登记的（当前在跑的那个）', () => {
    markTaskActive('s1', 'stage-1');
    markTaskActive('s1', 'stage-2');
    expect(getActiveTaskIdForSession('s1')).toBe('stage-2');
  });

  it('摘除一个任务不影响其它任务；摘空后会话无活跃任务', () => {
    markTaskActive('s1', 'stage-1');
    markTaskActive('s1', 'stage-2');
    markTaskInactive('stage-2');
    expect(getActiveTaskIdForSession('s1')).toBe('stage-1');
    markTaskInactive('stage-1');
    expect(getActiveTaskIdForSession('s1')).toBeUndefined();
  });

  it('releaseTaskScope 同时摘登记并回收该任务的放行记录', () => {
    const registry = getApprovedCommandRegistry();
    const hashA = hashCommand('echo p2-task-a');
    const hashB = hashCommand('echo p2-task-b');
    markTaskActive('s1', 'task-A');
    markTaskActive('s1', 'task-B');
    registry.approve('s1', hashA, undefined, {
      scopeKind: 'task',
      taskId: 'task-A',
    });
    registry.approve('s1', hashB, undefined, {
      scopeKind: 'task',
      taskId: 'task-B',
    });

    releaseTaskScope('task-A');

    // 登记层面：只剩 task-B（当前任务）
    expect(getActiveTaskIdForSession('s1')).toBe('task-B');
    // 放行层面：task-A 的记录已回收，task-B 仍有效
    expect(registry.isApproved('s1', hashA, undefined, 'task-A')).toBe(false);
    expect(registry.isApproved('s1', hashB, undefined, 'task-B')).toBe(true);
    registry.clearSession('s1');
  });
});
