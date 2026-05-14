import { EventEmitter } from 'events';
import type { HeartbeatState } from './types.js';

/**
 * HeartbeatManager 管理长时间运行回复的心跳消息。
 * 定期发送 heartbeat 以防止平台超时断开连接。
 */
export class HeartbeatManager extends EventEmitter {
  private state: HeartbeatState = {
    active: false,
    startedAt: 0,
    lastBeatAt: 0,
    intervalMs: 5000,
    beatCount: 0,
  };

  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * 启动心跳。
   */
  start(intervalMs: number = 5000): void {
    if (this.state.active) {
      return;
    }

    this.state = {
      active: true,
      startedAt: Date.now(),
      lastBeatAt: Date.now(),
      intervalMs,
      beatCount: 0,
    };

    this.timer = setInterval(() => {
      this.beat();
    }, intervalMs);

    this.emit('heartbeat:started', { intervalMs });
  }

  /**
   * 停止心跳。
   */
  stop(): void {
    if (!this.state.active) {
      return;
    }

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.state.active = false;
    this.emit('heartbeat:stopped', { beatCount: this.state.beatCount });
  }

  /**
   * 发送一次心跳。
   */
  private beat(): void {
    this.state.lastBeatAt = Date.now();
    this.state.beatCount++;

    this.emit('heartbeat', {
      beatCount: this.state.beatCount,
      elapsed: Date.now() - this.state.startedAt,
      timestamp: this.state.lastBeatAt,
    });
  }

  /**
   * 获取当前心跳状态。
   */
  getState(): HeartbeatState {
    return { ...this.state };
  }

  /**
   * 检查心跳是否活跃。
   */
  isActive(): boolean {
    return this.state.active;
  }

  /**
   * 更新心跳间隔（仅当心跳活跃时生效）。
   */
  setInterval(intervalMs: number): void {
    if (!this.state.active || this.timer === null) {
      return;
    }

    clearInterval(this.timer);
    this.state.intervalMs = intervalMs;
    this.timer = setInterval(() => {
      this.beat();
    }, intervalMs);
  }

  /**
   * 重置心跳状态。
   */
  reset(): void {
    this.stop();
    this.state = {
      active: false,
      startedAt: 0,
      lastBeatAt: 0,
      intervalMs: 5000,
      beatCount: 0,
    };
  }
}
