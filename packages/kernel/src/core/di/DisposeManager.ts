/**
 * 服务生命周期管理器
 * 负责注册和调用服务的 dispose 回调
 */
import { AppError, ErrorCategory, ErrorSeverity } from '../errors.js';

import type { ServiceDescriptor } from './types';

/** 单条 `onDispose` 的默认超时（ms）。容器关闭是**有界**过程，不能被一个卡住的回调拖死。 */
export const DEFAULT_DISPOSE_TIMEOUT_MS = 5_000;

export interface DisposeManagerOptions {
  /** 覆盖 {@link DEFAULT_DISPOSE_TIMEOUT_MS}（测试用于把超时压到毫秒级） */
  disposeTimeoutMs?: number;
}

export class DisposeManager {
  private disposeEntries = new Map<
    string,
    { onDispose: (instance: unknown) => Promise<void>; instance: unknown }
  >();

  private readonly timeoutMs: number;

  constructor(options: DisposeManagerOptions = {}) {
    this.timeoutMs = options.disposeTimeoutMs ?? DEFAULT_DISPOSE_TIMEOUT_MS;
  }

  /**
   * 注册服务的 dispose 回调
   */
  register<T>(id: string, descriptor: ServiceDescriptor<T>, instance: T): void {
    if (descriptor.onDispose) {
      this.disposeEntries.set(id, {
        onDispose: descriptor.onDispose as (instance: unknown) => Promise<void>,
        instance,
      });
    }
  }

  /**
   * 取消注册
   */
  unregister(id: string): void {
    this.disposeEntries.delete(id);
  }

  /** 真正执行一条 `onDispose`（无论成败都摘除条目） */
  private async runEntry(id: string): Promise<void> {
    const entry = this.disposeEntries.get(id);
    if (!entry) return;

    try {
      await entry.onDispose(entry.instance);
    } finally {
      this.disposeEntries.delete(id);
    }
  }

  /**
   * 释放指定服务（**不加超时**：单条语义保持原样，便于调用方自行控制）。
   * 容器整体关闭走 {@link disposeAll}，那条路径有超时保护。
   */
  async dispose(id: string): Promise<void> {
    return this.runEntry(id);
  }

  /**
   * 单条带超时释放（2026-10-24 复审 D）。
   *
   * 原实现是串行 `await` 且无超时：一个**永不返回**的 `onDispose` 会把整个关闭流程卡死
   * （进程退出挂起 / 重启时反复超时）。这里用 `Promise.race` 加一条上界；超时后
   * **摘除条目并继续下一条**，把"卡住"降级为"记为一条失败"。
   */
  private async disposeWithTimeout(id: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // 超时即摘除：避免同一条目在后续 `disposeAll` 里再次永久等待
        this.disposeEntries.delete(id);
        reject(
          new AppError(
            `服务 ${id} 的 onDispose 超时（>${this.timeoutMs}ms），已跳过`,
            ErrorCategory.EXECUTION,
            ErrorSeverity.MEDIUM,
            'DI_DISPOSE_TIMEOUT',
            { serviceId: id, timeoutMs: this.timeoutMs }
          )
        );
      }, this.timeoutMs);
      // 不阻止进程退出（超时计时器本身不应成为"进程不退出"的原因）
      timer.unref?.();
    });

    // 迟到的 rejection 也要有承接：超时已判负后，原 promise 再拒绝不能变成 unhandled rejection
    const run = this.runEntry(id);
    run.catch(() => undefined);

    try {
      await Promise.race([run, guard]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * 按拓扑逆序释放所有服务。
   *
   * 评审 #7：逐个 try/catch 收集错误并继续（原实现首个抛错即中断 ⇒ 后续服务全部漏释放）。
   * 复审 D：每条再加**超时上界**（见 {@link disposeWithTimeout}）。
   * 单个错误原样抛（保持既有 catch 语义），多个用 `AggregateError`。
   */
  async disposeAll(order: string[]): Promise<void> {
    const errors: unknown[] = [];
    for (let i = order.length - 1; i >= 0; i--) {
      try {
        await this.disposeWithTimeout(order[i]);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, `${errors.length} 个服务释放失败`);
    }
  }

  /**
   * 清空所有条目
   */
  clear(): void {
    this.disposeEntries.clear();
  }
}
