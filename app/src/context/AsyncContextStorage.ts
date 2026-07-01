import { AsyncLocalStorage } from 'async_hooks';
import type { Context, SessionContext } from './types/Context';

export class AsyncContextStorage {
  private storage = new AsyncLocalStorage<Record<string, Context>>();

  run<T>(context: Record<string, Context>, fn: () => T): T {
    return this.storage.run(context, fn);
  }

  getStore(): Record<string, Context> | undefined {
    return this.storage.getStore();
  }

  hasStore(): boolean {
    return this.storage.getStore() !== undefined;
  }

  clearStore(): void {
    this.storage.run({}, () => {});
  }
}

export const asyncContextStorage = new AsyncContextStorage();

/**
 * 获取当前异步上下文中的会话上下文
 * 在 SessionGateway 入口注入后，深层调用链可通过此函数获取会话信息
 */
export function getCurrentSessionContext(): SessionContext | undefined {
  const store = asyncContextStorage.getStore();
  return store?.session as SessionContext | undefined;
}
