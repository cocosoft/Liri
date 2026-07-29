/**
 * ResourceArbiter — 资源优先级仲裁器
 *
 * P0-2: 防止并行任务之间的资源冲突。
 * 优先规则：用户输入 > Steering > Cron > AlwaysOn
 * TTL 30min 自动清理过期锁（防止进程崩溃后锁永久泄露）
 */
import { cg3Log } from '../cg3Env';

const RESOURCE_PRIORITY: Record<string, number> = {
  user: 0,
  steering: 1,
  cron: 2,
  alwayson: 3,
};

export class ResourceArbiter {
  /** resource → timestamp */
  private locks = new Map<string, number>();
  private lockTimeoutMs: number;

  constructor(lockTimeoutMs = 30 * 60 * 1000) {
    this.lockTimeoutMs = lockTimeoutMs;
  }

  /** 尝试获取资源锁 */
  acquire(resource: string): boolean {
    // 先清理过期锁
    const now = Date.now();
    for (const [r, ts] of this.locks) {
      if (now - ts > this.lockTimeoutMs) {
        this.locks.delete(r);
        cg3Log('tasks:alwayson:arbiter', 'warn', 'expiredLockReleased', { resource: r, heldMs: now - ts });
      }
    }

    // 同一资源已持有 → 拒绝（非可重入）
    if (this.locks.has(resource)) return false;

    const reqPriority = RESOURCE_PRIORITY[resource] ?? 99;
    // 检查更高优先级是否已持有
    for (const [r] of this.locks) {
      const heldPriority = RESOURCE_PRIORITY[r] ?? 99;
      if (heldPriority < reqPriority) {
        cg3Log('tasks:alwayson:arbiter', 'debug', 'blocked', { resource, by: r });
        return false;
      }
    }

    this.locks.set(resource, now);
    cg3Log('tasks:alwayson:arbiter', 'debug', 'acquired', { resource });
    return true;
  }

  /** 释放资源锁 */
  release(resource: string): void {
    if (this.locks.has(resource)) {
      this.locks.delete(resource);
      cg3Log('tasks:alwayson:arbiter', 'debug', 'released', { resource });
    }
  }

  /** 是否被占用 */
  isBusy(): boolean {
    return this.locks.size > 0;
  }

  /** 获取当前持有的锁列表 */
  getHeldResources(): string[] {
    return [...this.locks.keys()];
  }
}
