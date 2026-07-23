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

  /**
   * @deprecated 使用 resetStore() 替代。clearStore() 语义有误——AsyncLocalStorage.run({}, fn)
   * 仅创建新的作用域快照，不影响当前调用链中 getStore() 的返回值。
   * resetStore() 使用 enterWith({})（Node.js 20+）立即覆盖当前 store。
   */
  clearStore(): void {
    this.storage.run({}, () => {});
  }

  /**
   * 重置当前 store 为空。使用 enterWith({}) 确保同一 async 链中后续 getStore() 返回空。
   * 需要 Node.js 20+。
   */
  resetStore(): void {
    this.storage.enterWith({});
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
