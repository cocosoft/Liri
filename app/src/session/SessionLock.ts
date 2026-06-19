import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

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
      } catch {
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

        return {
          success: true,
          holder: this.instanceId,
          acquiredAt: lockData.acquiredAt,
        };
      } catch (err: any) {
        if (err.code === 'EEXIST' || err.code === 'EWOULDBLOCK') {
          await this.sleep(this.retryInterval);
          continue;
        }
        throw err;
      }
    }

    const currentHolder = await this.getCurrentHolder(sessionId);
    return { success: false, holder: currentHolder ?? undefined };
  }

  async release(sessionId: string): Promise<boolean> {
    const held = this.heldLocks.get(sessionId);
    if (!held) {
      return false;
    }

    if (held.holder !== this.instanceId) {
      logger.warning(
        `Cannot release lock for session ${sessionId}: not the holder`
      );
      return false;
    }

    const lockFile = this.getLockFilePath(sessionId);
    try {
      await fs.unlink(lockFile);
    } catch {
      // Lock file may already be deleted
    }

    this.heldLocks.delete(sessionId);
    return true;
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
    } catch {
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
    } catch {
      return null;
    }
  }

  async releaseAll(): Promise<void> {
    const keys = Array.from(this.heldLocks.keys());
    await Promise.all(keys.map((id) => this.release(id)));
  }

  private getLockFilePath(sessionId: string): string {
    return join(this.lockDir, `${sessionId}.lock`);
  }

  private async ensureLockDir(): Promise<void> {
    try {
      await fs.mkdir(this.lockDir, { recursive: true });
    } catch {
      // Directory already exists
    }
  }

  private async readLockFile(
    lockFile: string
  ): Promise<{ holder: string; acquiredAt: number } | null> {
    try {
      const content = await fs.readFile(lockFile, 'utf-8');
      return JSON.parse(content);
    } catch {
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
    } catch {
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
