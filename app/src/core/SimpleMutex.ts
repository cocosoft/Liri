/**
 * 简单互斥锁（零外部依赖）
 * 用于保护 SQLite 写操作，防止并发写入导致 WAL 锁冲突
 *
 * 使用场景：ChronosDatabase、CostRecordRepository、QueryLogStore、TodoWriteTool
 */
export class SimpleMutex {
  private queue: Array<() => void> = [];
  private locked = false;
  private createdAt: number = Date.now();

  /** 默认超时 30 秒，防止死锁永久阻塞 */
  static readonly DEFAULT_TIMEOUT_MS = 30_000;

  async acquire(timeoutMs?: number): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    const effectiveTimeout = timeoutMs ?? SimpleMutex.DEFAULT_TIMEOUT_MS;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // BUG-2 修复：超时只从队列移除自己，不做全局解锁。
        // 原实现 `if (queue.length === 0) locked = false` 会在队列只剩自己时
        // 错误清零持有者 A 的锁，导致后续请求与 A 并发进入临界区。
        // 锁的释放只能由持有者 release() 决定，等待者超时无权解锁他人。
        const idx = this.queue.indexOf(onAcquired);
        if (idx >= 0) this.queue.splice(idx, 1);
        reject(
          new Error(`SimpleMutex: acquire timeout after ${effectiveTimeout}ms`)
        );
      }, effectiveTimeout);
      const onAcquired = () => {
        clearTimeout(timer);
        resolve();
      };
      this.queue.push(onAcquired);
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

  /** 在互斥锁保护下执行异步操作（支持超时） */
  async run<T>(fn: () => Promise<T>, timeoutMs?: number): Promise<T> {
    await this.acquire(timeoutMs);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** 获取锁持有时间（诊断用） */
  getHeldDurationMs(): number {
    return this.locked ? Date.now() - this.createdAt : 0;
  }
}
