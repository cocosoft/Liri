/**
 * 简单互斥锁（零外部依赖）
 * 用于保护 SQLite 写操作，防止并发写入导致 WAL 锁冲突
 *
 * 使用场景：ChronosDatabase、CostRecordRepository、QueryLogStore、TodoWriteTool
 */
export class SimpleMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }

  /** 在互斥锁保护下执行异步操作 */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}