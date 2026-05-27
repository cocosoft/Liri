import { asyncContextStorage } from '../AsyncContextStorage';
import type { Context } from '../types/Context';

export class NodeContextAdapter {
  run<T>(context: Record<string, Context>, fn: () => T): T {
    return asyncContextStorage.run(context, fn);
  }

  getContext(): Record<string, Context> | undefined {
    return asyncContextStorage.getStore();
  }

  hasContext(): boolean {
    return asyncContextStorage.hasStore();
  }
}
