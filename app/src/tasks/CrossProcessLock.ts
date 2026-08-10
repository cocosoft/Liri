/**
 * CrossProcessLock — 跨进程调度锁
 *
 * P3-2: 对标 hermes-agent 跨进程调度锁（O_EXCL 原子创建 + PID 存活探测 + 过期恢复）。
 * 防止多个进程实例同时触发同一 Cron 任务。
 *
 * 设计:
 *   - fs.openSync(path, 'wx') 实现 O_EXCL 原子创建（跨进程互斥）
 *   - 锁文件内容为 PID，用于存活探测
 *   - 获取到锁的进程定期更新心跳（默认 30s）
 *   - 其他进程读取 PID 调用 process.kill(pid, 0) 检测存活
 *   - PID 已死则删除过期锁文件并尝试获取
 *   - 支持 TTL 自动过期（默认 60s，超过无心跳则视为过期）
 */

import {
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  statSync,
  utimesSync,
} from 'fs';
import { resolveDataSubDir } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('tasks:crossProcessLock');

/** 锁文件存放目录 */
const LOCK_DIR = resolveDataSubDir('locks');

/** 默认心跳间隔（ms） */
const DEFAULT_HEARTBEAT_MS = 30_000;

/** 默认 TTL（ms，超过无心跳视为过期） */
const DEFAULT_TTL_MS = 60_000;

export interface CrossProcessLockOptions {
  /** 锁名称（用于生成文件名） */
  name: string;
  /** 心跳间隔（ms），默认 30s */
  heartbeatMs?: number;
  /** TTL（ms），默认 60s */
  ttlMs?: number;
}

export class CrossProcessLock {
  private name: string;
  private lockPath: string;
  private heartbeatMs: number;
  private ttlMs: number;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private acquired: boolean = false;

  constructor(options: CrossProcessLockOptions) {
    this.name = options.name;
    this.lockPath = `${LOCK_DIR}/${options.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.lock`;
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  /**
   * 尝试获取跨进程锁
   * @returns true 获取成功，false 锁已被其他进程持有
   */
  tryAcquire(): boolean {
    try {
      // 确保锁目录存在
      if (!existsSync(LOCK_DIR)) {
        mkdirSync(LOCK_DIR, { recursive: true });
      }

      // 检查已有锁文件
      if (existsSync(this.lockPath)) {
        const isExpired = this.checkAndCleanExpired();
        if (!isExpired) {
          return false; // 锁有效，获取失败
        }
        // 过期锁已清理，继续尝试获取
      }

      // O_EXCL 原子创建（'wx' flag = write + exclusive）
      const fd = openSync(this.lockPath, 'wx');
      writeFileSync(fd, String(process.pid), 'utf-8');
      closeSync(fd);

      this.acquired = true;
      this.startHeartbeat();
      logger.info('crossProcessLock:acquired', {
        name: this.name,
        pid: process.pid,
      });
      return true;
    } catch (err) {
      // 'wx' 模式下文件已存在会抛 EEXIST — 其他进程抢先了
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        return false;
      }
      handleError(err, {
        module: 'tasks:crossProcessLock',
        action: 'tryAcquire',
      });
      return false;
    }
  }

  /**
   * 释放锁
   */
  release(): void {
    this.stopHeartbeat();
    if (!this.acquired) return;

    try {
      if (existsSync(this.lockPath)) {
        // 仅当锁文件中的 PID 匹配时才删除（防止误删其他进程的锁）
        const storedPid = this.readLockPid();
        if (storedPid === process.pid) {
          unlinkSync(this.lockPath);
          logger.info('crossProcessLock:released', {
            name: this.name,
            pid: process.pid,
          });
        }
      }
    } catch (err) {
      handleError(err, { module: 'tasks:crossProcessLock', action: 'release' });
    } finally {
      this.acquired = false;
    }
  }

  /**
   * 检查锁是否被当前进程持有
   */
  isAcquired(): boolean {
    return this.acquired;
  }

  /**
   * 检查并清理过期锁
   * @returns true 表示锁已过期并被清理
   */
  private checkAndCleanExpired(): boolean {
    try {
      const storedPid = this.readLockPid();
      if (storedPid === null) return true; // 无法读取，视为过期

      // PID 存活探测
      if (!this.isPidAlive(storedPid)) {
        this.forceClean();
        return true;
      }

      // 检查心跳/TTL
      const now = Date.now();
      try {
        const { mtimeMs } = statSync(this.lockPath);
        if (now - mtimeMs > this.ttlMs) {
          this.forceClean();
          return true;
        }
      } catch {
        return true; // 文件不存在，视为过期
      }

      return false; // 锁有效
    } catch (err) {
      handleError(err, {
        module: 'tasks:crossProcessLock',
        action: 'checkExpired',
      });
      return false;
    }
  }

  /**
   * PID 存活探测 — 使用 signal 0（不发送信号，仅检查进程是否存在）
   */
  private isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 读取锁文件中存储的 PID
   */
  private readLockPid(): number | null {
    try {
      const content = readFileSync(this.lockPath, 'utf-8').trim();
      const pid = parseInt(content, 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  /**
   * 强制清理锁文件（无论是否过期）
   */
  private forceClean(): void {
    try {
      if (existsSync(this.lockPath)) {
        unlinkSync(this.lockPath);
        logger.info('crossProcessLock:expiredClean', { name: this.name });
      }
    } catch (err) {
      handleError(err, {
        module: 'tasks:crossProcessLock',
        action: 'forceClean',
      });
    }
  }

  /**
   * 启动心跳（定期更新锁文件 mtime）
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      try {
        if (existsSync(this.lockPath)) {
          // touch — 更新 mtime 用于 TTL 判断
          const now = new Date();
          utimesSync(this.lockPath, now, now);
        }
      } catch (err) {
        handleError(err, {
          module: 'tasks:crossProcessLock',
          action: 'heartbeat',
        });
      }
    }, this.heartbeatMs);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

/**
 * 为 Cron 任务创建跨进程调度锁
 * 用于防止多进程实例重复触发同一任务
 */
export function createCronLock(jobId: string): CrossProcessLock {
  return new CrossProcessLock({
    name: `cron_${jobId}`,
    heartbeatMs: 30_000,
    ttlMs: 60_000,
  });
}
