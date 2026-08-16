// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Session Activity Tracker
 *
 * 对标 BA_REF sessionActivity.ts + concurrentSessions.ts，提供双层会话活动追踪：
 * 1. 进程级 — PID 文件注册，进程崩溃后可探活
 * 2. 内存级 — refcount 引用计数 + 心跳定时器
 *
 * 功能：
 * - startActivity / stopActivity — 引用计数管理
 * - 心跳检测 — 定期检查空闲会话
 * - PID 文件管理 — 进程探活 + 僵尸清理
 * - 并发上限 — 强制最大活跃会话数
 *
 * 设计原则：独立模块，不侵入现有 SessionStore。
 */

import {
  writeFileSync,
  readFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from 'fs';
import { join, dirname } from 'path';
import { resolvePyappHome } from '@modules/core/paths';

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
const logger = getLogger('session:activity:SessionActivityTracker');

// ============================================================================
// 类型定义
// ============================================================================

export interface ActivityConfig {
  /** 心跳间隔（毫秒，默认 30_000） */
  heartbeatIntervalMs: number;
  /** 空闲超时（毫秒）：refcount=0 且超过此后标记为 idle */
  idleTimeoutMs: number;
  /** 缓存清理超时（毫秒）：idle 超过此后从缓存移除 */
  evictTimeoutMs: number;
  /** 最大活跃会话数 */
  maxActiveSessions: number;
  /** PID 文件存储目录 */
  pidDir: string;
}

export interface SessionActivity {
  sessionId: string;
  /** 引用计数 */
  refcount: number;
  /** 最后一次活动时间 */
  lastActivityAt: number;
  /** 是否标记为 idle */
  idle: boolean;
}

export type ActivityEventCallback = (
  event: 'idle' | 'evicted' | 'limit_reached',
  sessionId: string
) => void;

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_CONFIG: ActivityConfig = {
  heartbeatIntervalMs: 30_000,
  idleTimeoutMs: 5 * 60 * 1000, // 5 minutes
  evictTimeoutMs: 30 * 60 * 1000, // 30 minutes
  maxActiveSessions: 5,
  pidDir: '~/.pyapp/data/sessions/pid',
};

// ============================================================================
// SessionActivityTracker
// ============================================================================

export class SessionActivityTracker {
  private config: ActivityConfig;
  private activities: Map<string, SessionActivity> = new Map();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private eventCallback: ActivityEventCallback | null = null;

  constructor(
    config?: Partial<ActivityConfig>,
    callback?: ActivityEventCallback
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.eventCallback = callback || null;
  }

  // ── 生命周期 ──

  /**
   * 启动心跳定时器 + 清理僵尸 PID 文件
   */
  start(): void {
    this.cleanupZombiePids();
    if (!this.heartbeatTimer) {
      this.heartbeatTimer = setInterval(() => {
        this.heartbeat();
      }, this.config.heartbeatIntervalMs);
      // P1-14 修复：unref 避免测试/CLI 进程被心跳定时器钉住不退出
      this.heartbeatTimer.unref();
    }
  }

  /**
   * 停止心跳定时器
   */
  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ── Activity 管理 ──

  /**
   * 注册活动（增加引用计数）
   */
  startActivity(sessionId: string): void {
    const existing = this.activities.get(sessionId);
    if (existing) {
      existing.refcount++;
      existing.lastActivityAt = Date.now();
      existing.idle = false;
    } else {
      // 检查并发上限
      const activeCount = this.getActiveCount();
      if (activeCount >= this.config.maxActiveSessions) {
        this.eventCallback?.('limit_reached', sessionId);
        // 仍然允许注册，但记录警告
      }

      this.activities.set(sessionId, {
        sessionId,
        refcount: 1,
        lastActivityAt: Date.now(),
        idle: false,
      });
      this.writePidFile(sessionId);
    }
  }

  /**
   * 减少引用计数
   */
  stopActivity(sessionId: string): void {
    const activity = this.activities.get(sessionId);
    if (!activity) return;

    activity.refcount = Math.max(0, activity.refcount - 1);
    activity.lastActivityAt = Date.now();

    if (activity.refcount === 0) {
      // refcount 归零不立即清理，等待心跳检测超时
    }
  }

  /**
   * 刷新活动时间（不改变 refcount）
   */
  touchActivity(sessionId: string): void {
    const activity = this.activities.get(sessionId);
    if (activity) {
      activity.lastActivityAt = Date.now();
    }
  }

  // ── 查询 ──

  /**
   * 获取当前活跃会话数（refcount > 0 或非 idle）
   */
  getActiveCount(): number {
    let count = 0;
    for (const a of this.activities.values()) {
      if (!a.idle) count++;
    }
    return count;
  }

  /**
   * 获取会话活动状态
   */
  getActivity(sessionId: string): SessionActivity | undefined {
    return this.activities.get(sessionId);
  }

  /**
   * 检查是否已注册（refcount > 0）
   */
  isActive(sessionId: string): boolean {
    const a = this.activities.get(sessionId);
    return a ? a.refcount > 0 : false;
  }

  // ── PID 文件管理 ──

  /**
   * 写入 PID 文件
   */
  private writePidFile(sessionId: string): void {
    try {
      const pidPath = this.getPidPath(sessionId);
      const pidDir = dirname(pidPath);
      if (!existsSync(pidDir)) {
        mkdirSync(pidDir, { recursive: true });
      }
      writeFileSync(pidPath, String(process.pid), 'utf-8');
    } catch (err) {
      // PID 写入失败不影响主流程

      handleError(err, {
        module: 'session:activity',
        action: 'writePidFile',
      });
    }
  }

  /**
   * 删除 PID 文件
   */
  private removePidFile(sessionId: string): void {
    try {
      const pidPath = this.getPidPath(sessionId);
      if (existsSync(pidPath)) {
        unlinkSync(pidPath);
      }
    } catch (err) {
      // 删除失败不影响

      handleError(err, {
        module: 'session:activity',
        action: 'removePidFile',
      });
    }
  }

  /**
   * 检查 PID 对应的进程是否存活
   */
  isProcessAlive(pid: number): boolean {
    try {
      // 跨平台进程探活：发送信号 0 不实际发信号，只检查进程存在性
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 清理僵尸 PID 文件（启动时调用）
   * 遍历 PID 目录，删除进程已退出的 PID 文件
   */
  private cleanupZombiePids(): void {
    // #16 修复：原实现为空函数体，PID 文件只在 evicted 时删除，
    // 进程异常退出（未走 evict）会残留 .pid 文件并持续累积。
    try {
      const pidDir = this.config.pidDir.replace(
        /^~\/\.pyapp/,
        resolvePyappHome()
      );
      if (!existsSync(pidDir)) return;
      const entries = readdirSync(pidDir);
      for (const name of entries) {
        if (!name.endsWith('.pid')) continue;
        const pidPath = join(pidDir, name);
        try {
          const raw = readFileSync(pidPath, 'utf-8').trim();
          const pid = Number(raw);
          if (!Number.isFinite(pid) || !this.isProcessAlive(pid)) {
            unlinkSync(pidPath);
            logger.info('清理僵尸 PID 文件', {
              pidPath,
              pid: Number.isFinite(pid) ? pid : undefined,
            });
          }
        } catch (err) {
          handleError(err, {
            module: 'session:activity',
            action: 'cleanupZombiePids',
          });
        }
      }
    } catch (err) {
      // PID 目录不存在或不可读时静默跳过（路径可能未创建）
      handleError(err, {
        module: 'session:activity',
        action: 'cleanupZombiePids',
      });
    }
  }

  private getPidPath(sessionId: string): string {
    const pyappHome = resolvePyappHome();
    return join(
      this.config.pidDir.replace(/^~\/\.pyapp/, pyappHome),
      `${sessionId}.pid`
    );
  }

  // ── 内部心跳逻辑 ──

  /**
   * 心跳检查：标记 idle 并清理超时会话
   */
  private heartbeat(): void {
    const now = Date.now();
    const toEvict: string[] = [];

    for (const [sessionId, activity] of this.activities) {
      if (activity.refcount === 0) {
        const idleDuration = now - activity.lastActivityAt;

        if (!activity.idle && idleDuration > this.config.idleTimeoutMs) {
          // 标记为 idle
          activity.idle = true;
          this.eventCallback?.('idle', sessionId);
        }

        if (activity.idle && idleDuration > this.config.evictTimeoutMs) {
          // 超时驱逐
          toEvict.push(sessionId);
        }
      }
    }

    // 驱逐超时会话
    for (const sessionId of toEvict) {
      this.activities.delete(sessionId);
      this.removePidFile(sessionId);
      this.eventCallback?.('evicted', sessionId);
    }
  }
}
