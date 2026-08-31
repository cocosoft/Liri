/**
 * BaseTask 任务级熔断测试（P1-1，对标 Hermes kanban consecutive_failures）
 *
 * 覆盖：
 * - 连续失败达阈值（默认 3）→ 自动置 BLOCKED + circuitBreakReason
 * - 未达阈值 → 保持 FAILED 且计数递增
 * - 失败后成功（非 FAILED 状态）→ 计数重置 + 熔断原因清除
 * - BLOCKED 非终态（endTime 不设置）
 */
import { describe, test, expect } from 'bun:test';
import { BaseTask, getCircuitBreakerThreshold } from '../../src/tasks/BaseTask';
import { TaskStatus, TaskType, isTerminalTaskStatus } from '../../src/tasks/types';

class TestTask extends BaseTask {
  readonly type = TaskType.BACKGROUND_AGENT;

  async spawn(): Promise<void> {}
  async kill(): Promise<void> {}

  public fail(error?: string): void {
    this.setStatus(TaskStatus.FAILED, error);
  }
  public run(): void {
    this.setStatus(TaskStatus.RUNNING);
  }
  public complete(): void {
    this.setStatus(TaskStatus.COMPLETED);
  }
}

function createTask(id: string): TestTask {
  return new TestTask(id, `task-${id}`, '', TaskType.BACKGROUND_AGENT);
}

describe('BaseTask 任务级熔断（P1-1）', () => {
  const threshold = getCircuitBreakerThreshold();

  test(`连续失败 ${threshold} 次自动置 BLOCKED + 记录熔断原因`, () => {
    const task = createTask('t1');
    // 失败次数 < 阈值：保持 FAILED，计数递增
    for (let i = 1; i < threshold; i++) {
      task.fail(`err-${i}`);
      expect(task.taskState.status).toBe(TaskStatus.FAILED);
      expect(task.taskState.consecutiveFailures).toBe(i);
      expect(task.taskState.circuitBreakReason).toBeUndefined();
    }
    // 达阈值：自动 BLOCKED
    task.fail('final-error');
    const state = task.taskState;
    expect(state.status).toBe(TaskStatus.BLOCKED);
    expect(state.consecutiveFailures).toBe(threshold);
    expect(state.circuitBreakReason).toContain('熔断');
    expect(state.error).toBe('final-error');
    // BLOCKED 非终态（endTime 不设置，等待人工恢复）
    expect(isTerminalTaskStatus(state.status)).toBe(false);
    expect(state.endTime).toBeUndefined();
  });

  test('失败后成功重置计数并清除熔断原因', () => {
    const task = createTask('t2');
    for (let i = 0; i < threshold - 1; i++) {
      task.fail(`err-${i}`);
    }
    expect(task.taskState.consecutiveFailures).toBe(threshold - 1);
    // 恢复运行 → 计数重置、熔断原因清除
    task.run();
    expect(task.taskState.consecutiveFailures).toBe(0);
    expect(task.taskState.circuitBreakReason).toBeUndefined();
    // 再失败重新计数
    task.fail('err-again');
    expect(task.taskState.consecutiveFailures).toBe(1);
    expect(task.taskState.status).toBe(TaskStatus.FAILED);
  });

  test('熔断后可恢复 RUNNING（人工恢复）', () => {
    const task = createTask('t3');
    for (let i = 0; i < threshold; i++) {
      task.fail(`err-${i}`);
    }
    expect(task.taskState.status).toBe(TaskStatus.BLOCKED);
    task.run();
    expect(task.taskState.status).toBe(TaskStatus.RUNNING);
    expect(task.taskState.consecutiveFailures).toBe(0);
  });

  test('阈值常量默认 ≥ 1（环境变量未配置时使用默认 3）', () => {
    expect(threshold).toBeGreaterThanOrEqual(1);
  });
});
