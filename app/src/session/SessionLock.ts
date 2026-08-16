import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';

const logger = getLogger('session:lock');

export interface LockOptions {
  lockDir?: string;
  timeout?: number;
  retryInterval?: number;
  staleThreshold?: number;
}

export interface LockAcquireResult {
  success: boolean;
  holder?: string;
  acquiredAt?: number;
}

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRY_INTERVAL = 100;
const DEFAULT_STALE_THRESHOLD = 60000;

export class SessionLock {
  private lockDir: string;
  private timeout: number;
  private retryInterval: number;
  private staleThreshold: number;
  private heldLocks: Map<string, { holder: string; acquiredAt: number }> =
    new Map();
  private readonly instanceId: string;

  constructor(options: LockOptions = {}) {
    this.lockDir = options.lockDir ?? join(tmpdir(), 'Liri', 'session_locks');
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.retryInterval = options.retryInterval ?? DEFAULT_RETRY_INTERVAL;
    this.staleThreshold = options.staleThreshold ?? DEFAULT_STALE_THRESHOLD;
    this.instanceId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async acquire(
    sessionId: string,
    customTimeout?: number
  ): Promise<LockAcquireResult> {
    const otel = getOTelTracing();
    const span = otel.startSpan('SessionLock.acquire', {
      'session.id': sessionId,
    });

    try {
      const lockFile = this.getLockFilePath(sessionId);
      await this.ensureLockDir();

      const timeout = customTimeout ?? this.timeout;
      const startTime = Date.now();

      while (Date.now() - startTime < timeout) {
        try {
          const existing = await this.readLockFile(lockFile);
          if (existing) {
            if (this.isStale(existing.acquiredAt)) {
              logger.warning(
                `Stale lock detected for session ${sessionId}, attempting to break`
              );
              await this.releaseStale(sessionId, existing.holder);
              continue;
            }

            await this.sleep(this.retryInterval);
            continue;
          }
        } catch (err) {
          // Lock file doesn't exist or can't be read, proceed to acquire
        }

        const lockData = {
          holder: this.instanceId,
          acquiredAt: Date.now(),
        };

        try {
          const fileHandle = await fs.open(lockFile, 'wx');
          await fileHandle.writeFile(JSON.stringify(lockData), 'utf-8');
          await fileHandle.close();

          this.heldLocks.set(sessionId, {
            holder: this.instanceId,
            acquiredAt: lockData.acquiredAt,
          });

          otel.endSpan(span);
          return {
            success: true,
            holder: this.instanceId,
            acquiredAt: lockData.acquiredAt,
          };
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'EEXIST' || code === 'EWOULDBLOCK') {
            await this.sleep(this.retryInterval);
            continue;
          }
          throw err;
        }
      }

      const currentHolder = await this.getCurrentHolder(sessionId);
      otel.endSpan(span);
      return { success: false, holder: currentHolder ?? undefined };
    } catch (e) {
      otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
      otel.endSpan(span, SpanStatusCode.ERROR);
      await handleError(e, {
        module: 'session:lock',
        action: 'acquire',
        context: { sessionId },
        rethrow: true,
      });
      throw e;
    }
  }

  async release(sessionId: string): Promise<boolean> {
    const otel = getOTelTracing();
    const span = otel.startSpan('SessionLock.release', {
      'session.id': sessionId,
    });

    try {
      const held = this.heldLocks.get(sessionId);
      if (!held) {
        otel.endSpan(span);
        return false;
      }

      if (held.holder !== this.instanceId) {
        logger.warning(
          `Cannot release lock for session ${sessionId}: not the holder`
        );
        otel.endSpan(span);
        return false;
      }

      const lockFile = this.getLockFilePath(sessionId);
      try {
        await fs.unlink(lockFile);
      } catch (err) {
        // Lock file may already be deleted
      }

      this.heldLocks.delete(sessionId);
      otel.endSpan(span);
      return true;
    } catch (e) {
      otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
      otel.endSpan(span, SpanStatusCode.ERROR);
      await handleError(e, {
        module: 'session:lock',
        action: 'release',
        context: { sessionId },
        rethrow: true,
      });
      throw e;
    }
  }

  async isLocked(sessionId: string): Promise<boolean> {
    const lockFile = this.getLockFilePath(sessionId);
    try {
      const data = await this.readLockFile(lockFile);
      if (!data) return false;
      if (this.isStale(data.acquiredAt)) {
        await this.releaseStale(sessionId, data.holder);
        return false;
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  async getCurrentHolder(sessionId: string): Promise<string | null> {
    const lockFile = this.getLockFilePath(sessionId);
    try {
      const data = await this.readLockFile(lockFile);
      if (!data) return null;
      if (this.isStale(data.acquiredAt)) {
        await this.releaseStale(sessionId, data.holder);
        return null;
      }
      return data.holder;
    } catch (err) {
      return null;
    }
  }

  async releaseAll(): Promise<void> {
    const keys = Array.from(this.heldLocks.keys());
    await Promise.all(keys.map((id) => this.release(id)));
  }

  /**
   * 续约锁（P1-28 修复）：长事务（compact 大会话/批量迁移）持锁超过
   * staleThreshold 会被其他进程判为 stale 并强拆，导致双持有者并发写。
   * 持有者应在长事务中定期调用本方法刷新锁时间戳。
   * @param sessionId 会话 ID
   * @returns 续约是否成功（非持有者/未持有返回 false）
   */
  async renew(sessionId: string): Promise<boolean> {
    const held = this.heldLocks.get(sessionId);
    if (!held || held.holder !== this.instanceId) {
      return false;
    }

    const now = Date.now();
    const lockData = { holder: this.instanceId, acquiredAt: now };
    const lockFile = this.getLockFilePath(sessionId);
    try {
      await fs.writeFile(lockFile, JSON.stringify(lockData), 'utf-8');
      held.acquiredAt = now;
      this.heldLocks.set(sessionId, held);
      logger.debug('Session lock renewed', { sessionId });
      return true;
    } catch (err) {
      // 锁文件被并发删除（已被 releaseStale 强拆）时续约失败，通知持有者
      logger.warning('Session lock renew failed', {
        sessionId,
        error: String(err),
      });
      this.heldLocks.delete(sessionId);
      return false;
    }
  }

  private getLockFilePath(sessionId: string): string {
    // P1-28 修复：sessionId 若来自外部输入（HTTP :id 参数）且含 `..\` 可路径穿越
    // 写到任意目录。白名单校验：仅允许字母数字、点、横线、下划线。
    if (!/^[\w.-]+$/.test(sessionId)) {
      throw new Error(`Invalid sessionId for lock: ${sessionId}`);
    }
    return join(this.lockDir, `${sessionId}.lock`);
  }

  private async ensureLockDir(): Promise<void> {
    try {
      await fs.mkdir(this.lockDir, { recursive: true });
    } catch (err) {
      // Directory already exists
    }
  }

  private async readLockFile(
    lockFile: string
  ): Promise<{ holder: string; acquiredAt: number } | null> {
    try {
      const content = await fs.readFile(lockFile, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      return null;
    }
  }

  private isStale(acquiredAt: number): boolean {
    return Date.now() - acquiredAt > this.staleThreshold;
  }

  private async releaseStale(sessionId: string, holder: string): Promise<void> {
    const lockFile = this.getLockFilePath(sessionId);
    try {
      await fs.unlink(lockFile);
      logger.warning(
        `Released stale lock for session ${sessionId} held by ${holder}`
      );
    } catch (err) {
      // Another process may have already released it
    }

    if (this.heldLocks.get(sessionId)?.holder === holder) {
      this.heldLocks.delete(sessionId);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
