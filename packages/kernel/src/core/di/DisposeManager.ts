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
   * 按拓扑逆序释放所有服务
   */
  async disposeAll(order: string[]): Promise<void> {
    for (let i = order.length - 1; i >= 0; i--) {
      await this.dispose(order[i]);
    }
  }

  /**
   * 清空所有条目
   */
  clear(): void {
    this.disposeEntries.clear();
  }
}
