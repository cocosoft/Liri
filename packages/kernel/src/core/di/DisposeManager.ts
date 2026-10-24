/**
 * 服务生命周期管理器
 * 负责注册和调用服务的 dispose 回调
 */
import type { ServiceDescriptor } from './types';

export class DisposeManager {
  private disposeEntries = new Map<
    string,
    { onDispose: (instance: unknown) => Promise<void>; instance: unknown }
  >();

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

  /**
   * 释放指定服务
   */
  async dispose(id: string): Promise<void> {
    const entry = this.disposeEntries.get(id);
    if (!entry) return;

    try {
      await entry.onDispose(entry.instance);
    } finally {
      this.disposeEntries.delete(id);
    }
  }

  /**
   * 按拓扑逆序释放所有服务。
   * 评审 #7：逐个 try/catch 收集错误并继续（原实现首个抛错即中断 ⇒ 后续服务全部漏释放），
   * 单个错误原样抛、多个用 AggregateError。
   */
  async disposeAll(order: string[]): Promise<void> {
    const errors: unknown[] = [];
    for (let i = order.length - 1; i >= 0; i--) {
      try {
        await this.dispose(order[i]);
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
