import { AsyncLocalStorage } from 'async_hooks';
import type { Context } from './types/Context';

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
