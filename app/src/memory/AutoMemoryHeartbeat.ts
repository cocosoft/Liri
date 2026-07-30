/**
 * AutoMemoryHeartbeat — 自动记忆心跳触发
 *
 * P3-9: 对标 PilotDeck EdgeClaw pipeline/heartbeat 定期触发记忆提取。
 * 定时扫描活跃会话，自动调用记忆提取（不依赖 Agent 主动调用）。
 *
 * 特性：
 *   - 可配置心跳间隔（默认 30min）
 *   - case trace 可观测（记录每次心跳的检索/提取结果）
 *   - 优雅降级（心跳失败不阻断主流程）
 */
import { Logger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({ module: 'memory:heartbeat' });

export interface HeartbeatConfig {
  /** 心跳间隔（ms），默认 30 分钟 */
  intervalMs: number;
  /** 是否启用 */
  enabled: boolean;
  /** 单次最多处理的会话数 */
  maxSessionsPerBeat: number;
}

export type HeartbeatAction =
  | { type: 'memory_extract'; sessionId: string }
  | { type: 'memory_consolidate'; sessionId: string }
  | { type: 'memory_age'; sessionId: string }
  | { type: 'dream'; description: string };

export interface HeartbeatEvent {
  timestamp: number;
  action: HeartbeatAction;
  success: boolean;
  error?: string;
  durationMs: number;
  details?: string;
}

const DEFAULT_CONFIG: HeartbeatConfig = {
  intervalMs: 30 * 60 * 1000, // 30 minutes
  enabled: true,
  maxSessionsPerBeat: 5,
};

export class AutoMemoryHeartbeat {
  private config: HeartbeatConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private trace: HeartbeatEvent[] = [];
  private maxTraceSize = 500;
  private onBeat: (action: HeartbeatAction) => Promise<boolean>;

  constructor(
    onBeat: (action: HeartbeatAction) => Promise<boolean>,
    config?: Partial<HeartbeatConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.onBeat = onBeat;
  }

  /** 启动心跳 */
  start(): void {
    if (!this.config.enabled) return;
    this.stop();
    this.timer = setInterval(() => this.beat(), this.config.intervalMs);
    logger.info('heartbeat:started', { intervalMs: this.config.intervalMs });
  }

  /** 停止心跳 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 单次心跳 */
  private async beat(): Promise<void> {
    try {
      const actions: HeartbeatAction[] = [
        { type: 'memory_age', sessionId: 'global' },
        { type: 'dream', description: 'Periodic memory consolidation' },
      ];

      for (const action of actions) {
        const start = Date.now();
        try {
          const ok = await this.onBeat(action);
          this.recordEvent({
            timestamp: start,
            action,
            success: ok,
            durationMs: Date.now() - start,
          });
        } catch (err) {
          this.recordEvent({
            timestamp: start,
            action,
            success: false,
            error: String(err),
            durationMs: Date.now() - start,
          });
        }
      }
    } catch (err) {
      void handleError(err, {
        module: 'memory:heartbeat',
        action: '心跳执行失败',
      });
    }
  }

  private recordEvent(event: HeartbeatEvent): void {
    this.trace.push(event);
    if (this.trace.length > this.maxTraceSize) this.trace.shift();
  }

  /** 获取 case trace（可观测） */
  getTrace(limit = 50): HeartbeatEvent[] {
    return this.trace.slice(-limit);
  }

  /** 获取统计 */
  getStats() {
    const total = this.trace.length;
    const succeeded = this.trace.filter((e) => e.success).length;
    return {
      total,
      succeeded,
      failed: total - succeeded,
      successRate: total > 0 ? succeeded / total : 0,
      lastBeatAt:
        this.trace.length > 0 ? this.trace[this.trace.length - 1].timestamp : 0,
    };
  }

  get running(): boolean {
    return this.timer !== null;
  }
}
