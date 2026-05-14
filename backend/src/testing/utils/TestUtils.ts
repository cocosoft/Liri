/**
 * TestUtils 测试工具集
 * 对标 CC 的测试基础设施
 */

/**
 * 断言结果
 */
export interface AssertResult {
  pass: boolean;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

/**
 * Mock 函数
 */
export class MockFunction {
  private calls: unknown[][] = [];
  private returnValue: unknown = undefined;
  private implementation: ((...args: unknown[]) => unknown) | null = null;

  /**
   * 设置返回值
   */
  returns(value: unknown): this {
    this.returnValue = value;
    return this;
  }

  /**
   * 设置实现
   */
  implements(fn: (...args: unknown[]) => unknown): this {
    this.implementation = fn;
    return this;
  }

  /**
   * 调用模拟函数
   */
  fn(...args: unknown[]): unknown {
    this.calls.push(args);

    if (this.implementation) {
      return this.implementation(...args);
    }

    return this.returnValue;
  }

  /**
   * 获取调用次数
   */
  getCallCount(): number {
    return this.calls.length;
  }

  /**
   * 获取调用参数
   */
  getCall(index: number): unknown[] | undefined {
    return this.calls[index];
  }

  /**
   * 获取所有调用
   */
  getCalls(): unknown[][] {
    return [...this.calls];
  }

  /**
   * 重置
   */
  reset(): void {
    this.calls = [];
    this.returnValue = undefined;
    this.implementation = null;
  }
}

/**
 * 测试定时器控制
 */
export class FakeTimers {
  private originalTimers: {
    setTimeout: typeof globalThis.setTimeout;
    setInterval: typeof globalThis.setInterval;
    clearTimeout: typeof globalThis.clearTimeout;
    clearInterval: typeof globalThis.clearInterval;
    Date: typeof Date;
  } | null = null;
  private currentTime: number;
  private timers: Map<number, { callback: () => void; interval: number; repeat: boolean }> = new Map();
  private nextId: number = 1;

  constructor(now?: number) {
    this.currentTime = now || Date.now();
  }

  /**
   * 安装假定时器
   */
  install(): void {
    this.originalTimers = {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      setInterval: globalThis.setInterval.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
      Date: Date,
    };

    const self = this;

    (globalThis as any).setTimeout = (callback: () => void, ms: number) => {
      const id = self.nextId++;
      self.timers.set(id, { callback, interval: ms, repeat: false });
      return id;
    };

    (globalThis as any).setInterval = (callback: () => void, ms: number) => {
      const id = self.nextId++;
      self.timers.set(id, { callback, interval: ms, repeat: true });
      return id;
    };

    (globalThis as any).clearTimeout = (id: number) => {
      self.timers.delete(id);
    };

    (globalThis as any).clearInterval = (id: number) => {
      self.timers.delete(id);
    };
  }

  /**
   * 恢复原始定时器
   */
  uninstall(): void {
    if (this.originalTimers) {
      globalThis.setTimeout = this.originalTimers.setTimeout;
      globalThis.setInterval = this.originalTimers.setInterval;
      globalThis.clearTimeout = this.originalTimers.clearTimeout;
      globalThis.clearInterval = this.originalTimers.clearInterval;
      this.originalTimers = null;
    }
  }

  /**
   * 前进指定毫秒数
   */
  advance(ms: number): void {
    this.currentTime += ms;

    const expired = Array.from(this.timers.entries())
      .filter(([_, timer]) => this.currentTime >= timer.interval);

    for (const [id, timer] of expired) {
      timer.callback();

      if (timer.repeat) {
        this.timers.set(id, { ...timer, interval: this.currentTime + timer.interval });
      } else {
        this.timers.delete(id);
      }
    }
  }

  /**
   * 获取当前假时间
   */
  getNow(): number {
    return this.currentTime;
  }
}

/**
 * 创建一个 Mock 函数
 */
export function mockFn(): MockFunction {
  return new MockFunction();
}

/**
 * 创建一个模拟对象
 */
export function mockObject<T extends object>(obj: T, overrides?: Partial<T>): T {
  const mock: any = {};

  for (const key of Object.keys(obj)) {
    const mockFn = new MockFunction();
    mock[key] = (...args: unknown[]) => mockFn.fn(...args);
  }

  if (overrides) {
    Object.assign(mock, overrides);
  }

  return mock as T;
}

/**
 * 延迟等待
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
