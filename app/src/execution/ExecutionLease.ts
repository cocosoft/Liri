/**
 * Execution 生命周期 —— 租约句柄（PR1 / 2026-10-09）
 *
 * 调用方每次 `acquire()` 取得一个 lease，用于：
 * - 在异步续跑点自检所有权（`assertCurrent()` ⇒ fencing）；
 * - 结束时 `release()`（配合 `complete()` / `fail()`）。
 */
import type { ExecutionManager } from './ExecutionManager';
import type { ExecutionGeneration, ExecutionId } from './types';

export class ExecutionLease {
  constructor(
    readonly executionId: ExecutionId,
    readonly generation: ExecutionGeneration,
    private readonly manager: ExecutionManager
  ) {}

  /**
   * 断言本租约仍是该 session 的当前执行。
   *
   * 若执行已被顶替 / 代次不符 / 已结束 ⇒ 抛 `StaleExecutionError`。
   * 供"晚到完成"等异步续跑点调用，防止改写新执行的 session 状态（generation fencing）。
   */
  assertCurrent(): void {
    this.manager.assertCurrent(this.executionId, this.generation);
  }

  /** 非抛出版本：本租约是否仍为当前执行 */
  isCurrent(): boolean {
    return this.manager.isCurrent(this.executionId, this.generation);
  }

  /** 释放所有权（结束本次执行的生命周期） */
  release(): void {
    this.manager.release(this);
  }
}
