import { describe, it, expect, beforeEach } from 'bun:test';
import { ExecutionEngine } from './engine/ExecutionEngine';
import type { ExecutableTask } from './engine/ExecutionEngine';
import { LifecycleManager } from './lifecycle/LifecycleManager';

describe('ExecutionEngine', () => {
  let engine: ExecutionEngine;

  beforeEach(() => {
    engine = new ExecutionEngine();
  });

  it('executes a valid task successfully', async () => {
    const task: ExecutableTask = {
      id: 'task1',
      type: 'test',
      payload: 'hello',
      priority: 10,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: 0,
    };
    const result = await engine.execute(task);
    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.taskId).toBe('task1');
  });

  it('fails on empty id', async () => {
    const task: ExecutableTask = {
      id: '',
      type: 'test',
      payload: 'data',
      priority: 0,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: 0,
    };
    const result = await engine.execute(task);
    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
  });

  it('fails on empty payload', async () => {
    const task: ExecutableTask = {
      id: 'no-payload',
      type: 'test',
      payload: '',
      priority: 0,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: 0,
    };
    const result = await engine.execute(task);
    expect(result.success).toBe(false);
  });

  it('fails on negative maxRetries', async () => {
    const task: ExecutableTask = {
      id: 'bad-retry',
      type: 'test',
      payload: 'data',
      priority: 0,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: -1,
    };
    const validation = engine.validateTask(task);
    expect(validation.valid).toBe(false);
  });

  it('fails on invalid priority', async () => {
    const task: ExecutableTask = {
      id: 'bad-priority',
      type: 'test',
      payload: 'data',
      priority: 200,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: 0,
    };
    const validation = engine.validateTask(task);
    expect(validation.valid).toBe(false);
  });

  it('cancels a task before execution', async () => {
    const task: ExecutableTask = {
      id: 'cancel-me',
      type: 'test',
      payload: 'data',
      priority: 0,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: 0,
    };
    engine.cancelExecution(task.id);
    const result = await engine.execute(task);
    expect(result.status).toBe('cancelled');
    expect(result.success).toBe(false);
  });

  it('retrieves execution result', async () => {
    const task: ExecutableTask = {
      id: 'findable',
      type: 'test',
      payload: 'data',
      priority: 5,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: 0,
    };
    await engine.execute(task);
    const result = engine.getExecution('findable');
    expect(result).toBeDefined();
    expect(result!.success).toBe(true);
  });

  it('returns undefined for unknown execution', () => {
    const result = engine.getExecution('ghost');
    expect(result).toBeUndefined();
  });

  it('tracks execution metrics', async () => {
    const tasks: ExecutableTask[] = [
      {
        id: 'm1',
        type: 'test',
        payload: 'a',
        priority: 1,
        createdAt: Date.now(),
        retryCount: 0,
        maxRetries: 0,
      },
      {
        id: 'm2',
        type: 'test',
        payload: 'b',
        priority: 2,
        createdAt: Date.now(),
        retryCount: 0,
        maxRetries: 0,
      },
    ];
    for (const t of tasks) await engine.execute(t);
    const metrics = engine.getMetrics();
    expect(metrics.totalExecuted).toBe(2);
    expect(metrics.totalSucceeded).toBe(2);
  });

  it('tracks failed metrics', async () => {
    const task: ExecutableTask = {
      id: 'fail-metric',
      type: 'test',
      payload: '',
      priority: 0,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: 0,
    };
    await engine.execute(task);
    const metrics = engine.getMetrics();
    expect(metrics.totalFailed).toBe(1);
  });

  it('clears history', async () => {
    const task: ExecutableTask = {
      id: 'clearable',
      type: 'test',
      payload: 'data',
      priority: 5,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: 0,
    };
    await engine.execute(task);
    engine.clearHistory();
    expect(engine.getExecution('clearable')).toBeUndefined();
    expect(engine.getMetrics().totalExecuted).toBe(0);
  });
});

describe('LifecycleManager', () => {
  let manager: LifecycleManager;

  beforeEach(() => {
    manager = new LifecycleManager();
  });

  it('creates a task with created phase', () => {
    const status = manager.createTask('t1');
    expect(status.taskId).toBe('t1');
    expect(status.currentPhase).toBe('created');
    expect(status.executionCount).toBe(0);
  });

  it('transitions from created to scheduled', () => {
    manager.createTask('t1');
    const result = manager.transitionTo('t1', 'scheduled');
    expect(result).toBe(true);
    expect(manager.getStatus('t1')!.currentPhase).toBe('scheduled');
  });

  it('rejects invalid transition', () => {
    manager.createTask('t1');
    const result = manager.transitionTo('t1', 'completed');
    expect(result).toBe(false);
    expect(manager.getStatus('t1')!.currentPhase).toBe('created');
  });

  it('allows valid full cycle', () => {
    manager.createTask('t1');
    expect(manager.transitionTo('t1', 'scheduled')).toBe(true);
    expect(manager.transitionTo('t1', 'executing')).toBe(true);
    expect(manager.transitionTo('t1', 'completed')).toBe(true);
    expect(manager.getStatus('t1')!.currentPhase).toBe('completed');
  });

  it('allows rescheduling from completed', () => {
    manager.createTask('t1');
    manager.transitionTo('t1', 'scheduled');
    manager.transitionTo('t1', 'executing');
    manager.transitionTo('t1', 'completed');
    expect(manager.transitionTo('t1', 'scheduled')).toBe(true);
    expect(manager.getStatus('t1')!.currentPhase).toBe('scheduled');
  });

  it('tracks execution count', () => {
    manager.createTask('t1');
    manager.transitionTo('t1', 'scheduled');
    manager.transitionTo('t1', 'executing');
    manager.transitionTo('t1', 'completed');
    manager.transitionTo('t1', 'scheduled');
    manager.transitionTo('t1', 'executing');
    manager.transitionTo('t1', 'completed');
    expect(manager.getStatus('t1')!.executionCount).toBe(2);
  });

  it('tracks total runtime', async () => {
    manager.createTask('t1');
    manager.transitionTo('t1', 'scheduled');
    manager.transitionTo('t1', 'executing');
    await new Promise((r) => setTimeout(r, 5));
    manager.transitionTo('t1', 'completed');
    expect(manager.getStatus('t1')!.totalRuntime).toBeGreaterThan(0);
  });

  it('returns undefined for unknown task', () => {
    const status = manager.getStatus('ghost');
    expect(status).toBeUndefined();
  });

  it('lists tasks in a phase', () => {
    manager.createTask('a');
    manager.createTask('b');
    manager.transitionTo('a', 'scheduled');
    manager.transitionTo('b', 'scheduled');
    const scheduled = manager.getTasksInPhase('scheduled');
    expect(scheduled.length).toBe(2);
  });

  it('cleans up expired tasks', async () => {
    manager.createTask('old1');
    manager.createTask('old2');
    manager.transitionTo('old1', 'scheduled');
    manager.transitionTo('old2', 'scheduled');
    await new Promise((r) => setTimeout(r, 5));
    const expired = await manager.cleanupExpiredTasks(1);
    expect(expired.length).toBe(2);
    expect(manager.getStatus('old1')!.currentPhase).toBe('expired');
  });

  it('does not cleanup tasks within max age', async () => {
    manager.createTask('fresh');
    manager.transitionTo('fresh', 'scheduled');
    const expired = await manager.cleanupExpiredTasks(60000);
    expect(expired.length).toBe(0);
  });

  it('returns all statuses', () => {
    manager.createTask('a');
    manager.createTask('b');
    manager.createTask('c');
    expect(manager.getAllStatuses().length).toBe(3);
  });
});

describe('Chronos Integration', () => {
  it('integrates execution engine with lifecycle manager', async () => {
    const engine = new ExecutionEngine();
    const lifecycle = new LifecycleManager();

    lifecycle.createTask('int1');
    lifecycle.transitionTo('int1', 'scheduled');
    lifecycle.transitionTo('int1', 'executing');

    const task: ExecutableTask = {
      id: 'int1',
      type: 'test',
      payload: 'integrated',
      priority: 5,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: 0,
    };
    const result = await engine.execute(task);
    expect(result.success).toBe(true);

    lifecycle.transitionTo('int1', 'completed', '执行成功');
    const status = lifecycle.getStatus('int1');
    expect(status!.currentPhase).toBe('completed');
    expect(status!.executionCount).toBe(1);

    const metrics = engine.getMetrics();
    expect(metrics.totalExecuted).toBe(1);
  });

  it('handles execution failure in lifecycle', async () => {
    const engine = new ExecutionEngine();
    const lifecycle = new LifecycleManager();

    lifecycle.createTask('fail1');
    lifecycle.transitionTo('fail1', 'scheduled');
    lifecycle.transitionTo('fail1', 'executing');

    const task: ExecutableTask = {
      id: 'fail1',
      type: 'test',
      payload: '',
      priority: 0,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: 0,
    };
    const result = await engine.execute(task);
    expect(result.success).toBe(false);

    lifecycle.transitionTo('fail1', 'failed', result.error);
    expect(lifecycle.getStatus('fail1')!.currentPhase).toBe('failed');
  });

  it('supports reschedule lifecycle with multiple executions', async () => {
    const engine = new ExecutionEngine();
    const lifecycle = new LifecycleManager();

    lifecycle.createTask('recur');
    lifecycle.transitionTo('recur', 'scheduled');

    for (let i = 0; i < 3; i++) {
      lifecycle.transitionTo('recur', 'executing');
      const task: ExecutableTask = {
        id: `recur-${i}`,
        type: 'recurring',
        payload: `run-${i}`,
        priority: 1,
        createdAt: Date.now(),
        retryCount: 0,
        maxRetries: 0,
      };
      const result = await engine.execute(task);
      expect(result.success).toBe(true);
      lifecycle.transitionTo('recur', 'completed', `执行 #${i + 1} 完成`);
      lifecycle.transitionTo('recur', 'scheduled');
    }

    const status = lifecycle.getStatus('recur');
    expect(status!.executionCount).toBe(3);
    expect(engine.getMetrics().totalExecuted).toBe(3);
  });
});
