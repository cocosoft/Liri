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
      // P17（2026-09-01）：acquire 成功时记录本次持有开始时间——
      // 原实现 createdAt 仅实例创建时设置，会话级复用的锁（同会话多条消息）
      // 第二次 acquire 后 getHeldDurationMs 返回整个实例存活时长（失真）。
      this.createdAt = Date.now();
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

  /**
   * 是否被持有。
   *
   * 2026-10-19（CI 修复）：调用方原用 `getHeldDurationMs() > 0` 判"是否在飞"，
   * 但 acquire 与判定若落在**同一毫秒**，时长恒为 0 ⇒ 已持锁被误判为空闲
   * （macOS 上 `budgetSuspendStream` 的在飞守卫因此放行，随后等满 30s 超时）。
   * 持有状态应直接读布尔位，与时钟分辨率无关。
   */
  isLocked(): boolean {
    return this.locked;
  }

  /** 获取锁持有时间（诊断用） */
  getHeldDurationMs(): number {
    return this.locked ? Date.now() - this.createdAt : 0;
  }
}
