import type { Context } from '../types/Context';

export class TestContextAdapter {
  private contextStack: Record<string, Context>[] = [];

  run<T>(context: Record<string, Context>, fn: () => T): T {
    this.contextStack.push({ ...this.getCurrentContext(), ...context });

    try {
      return fn();
    } finally {
      this.contextStack.pop();
    }
  }

  getContext(): Record<string, Context> {
    return this.getCurrentContext();
  }

  hasContext(): boolean {
    return this.contextStack.length > 0;
  }

  private getCurrentContext(): Record<string, Context> {
    return this.contextStack[this.contextStack.length - 1] || {};
  }

  clear(): void {
    this.contextStack = [];
  }

  getStackLength(): number {
    return this.contextStack.length;
  }
}
