/**
 * HeartbeatMonitor 心跳监控
 * 对标 OpenClaw 的心跳策略
 */

/**
 * 心跳状态
 */
export type HeartbeatStatus = 'alive' | 'warning' | 'dead' | 'unknown';

/**
 * 心跳事件
 */
export interface HeartbeatEvent {
  taskId: string;
  status: HeartbeatStatus;
  timestamp: number;
  message?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 心跳配置
 */
export interface HeartbeatConfig {
  interval: number;
  timeout: number;
  maxMissed: number;
}

/**
 * 心跳监控器
 */
export class HeartbeatMonitor {
  private heartbeats: Map<
    string,
    { lastBeat: number; missed: number; status: HeartbeatStatus }
  > = new Map();
  private config: HeartbeatConfig;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private listeners: Array<(event: HeartbeatEvent) => void> = [];

  constructor(config?: Partial<HeartbeatConfig>) {
    this.config = {
      interval: config?.interval || 30000,
      timeout: config?.timeout || 60000,
      maxMissed: config?.maxMissed || 3,
    };
  }

  /**
   * 开始监控
   */
  start(): void {
    if (this.checkInterval) return;

    this.checkInterval = setInterval(() => {
      this.checkHeartbeats();
    }, this.config.interval);
  }

  /**
   * 停止监控
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * 注册心跳目标
   */
  register(taskId: string): void {
    this.heartbeats.set(taskId, {
      lastBeat: Date.now(),
      missed: 0,
      status: 'alive',
    });
  }

  /**
   * 注销心跳目标
   */
  unregister(taskId: string): void {
    this.heartbeats.delete(taskId);
  }

  /**
   * 接收心跳信号
   */
  beat(taskId: string, metadata?: Record<string, unknown>): void {
    const record = this.heartbeats.get(taskId);

    if (record) {
      record.lastBeat = Date.now();
      record.missed = 0;
      record.status = 'alive';

      this.emit({
        taskId,
        status: 'alive',
        timestamp: Date.now(),
        metadata,
      });
    }
  }

  /**
   * 获取心跳状态
   */
  getStatus(taskId: string): HeartbeatStatus {
    return this.heartbeats.get(taskId)?.status || 'unknown';
  }

  /**
   * 获取所有状态
   */
  getAllStatus(): Array<{
    taskId: string;
    status: HeartbeatStatus;
    lastBeat: number;
  }> {
    return Array.from(this.heartbeats.entries()).map(([taskId, record]) => ({
      taskId,
      status: record.status,
      lastBeat: record.lastBeat,
    }));
  }

  /**
   * 添加监听器
   */
  onStatusChange(listener: (event: HeartbeatEvent) => void): void {
    this.listeners.push(listener);
  }

  /**
   * 检查心跳
   */
  private checkHeartbeats(): void {
    const now = Date.now();

    for (const [taskId, record] of this.heartbeats.entries()) {
      const elapsed = now - record.lastBeat;

      if (elapsed > this.config.timeout) {
        record.missed++;

        if (record.missed >= this.config.maxMissed) {
          record.status = 'dead';

          this.emit({
            taskId,
            status: 'dead',
            timestamp: now,
            message: `连续 ${record.missed} 次心跳丢失`,
          });
        } else {
          record.status = 'warning';

          this.emit({
            taskId,
            status: 'warning',
            timestamp: now,
            message: `第 ${record.missed} 次心跳丢失`,
          });
        }
      }
    }
  }

  /**
   * 发送事件
   */
  private emit(event: HeartbeatEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {}
    }
  }
}

export const heartbeatMonitor = new HeartbeatMonitor();
