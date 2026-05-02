import type { Context } from '../types/Context';

export class BrowserContextAdapter {
  private context: Record<string, Context> = {};

  run<T>(context: Record<string, Context>, fn: () => T): T {
    const previousContext = { ...this.context };
    this.context = { ...previousContext, ...context };

    try {
      return fn();
    } finally {
      this.context = previousContext;
    }
  }

  getContext(): Record<string, Context> {
    return { ...this.context };
  }

  hasContext(): boolean {
    return Object.keys(this.context).length > 0;
  }
}
