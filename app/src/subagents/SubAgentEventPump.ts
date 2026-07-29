/**
 * SubAgentEventPump — 子代理事件泵与心跳
 *
 * P2-13: 对标 PilotDeck subagent_status 推送 + 500ms 轮询 + 2s 心跳。
 * 提供子代理运行时状态的实时推送和超时检测。
 *
 * 设计：
 *   - 500ms 轮询间隔采集子代理状态
 *   - 2s 心跳检测超时子代理
 *   - 通过 globalEventBus 推送 subagent_status 事件
 */
import { Logger } from '@modules/monitoring';

const logger = new Logger({ module: 'subagents:eventPump' });

export interface SubAgentHeartbeatState {
  subAgentId: string;
  lastHeartbeat: number;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'stale';
  startedAt: number;
  toolCount: number;
}

export interface SubAgentStatusEvent {
  type: 'subagent_status';
  subAgentId: string;
  status: string;
  timestamp: number;
  toolCount: number;
  elapsedMs: number;
}

export class SubAgentEventPump {
  private polling: Map<string, SubAgentHeartbeatState> = new Map();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private onStatusChange: ((event: SubAgentStatusEvent) => void) | null = null;

  constructor(
    private pollIntervalMs = 500,
    private heartbeatTimeoutMs = 2000
  ) {}

  /** 注册子代理 */
  register(subAgentId: string): void {
    if (this.polling.has(subAgentId)) return;
    this.polling.set(subAgentId, {
      subAgentId,
      lastHeartbeat: Date.now(),
      status: 'idle',
      startedAt: Date.now(),
      toolCount: 0,
    });
    logger.debug('pump:registered', { subAgentId });
  }

  /** 心跳刷新 */
  heartbeat(subAgentId: string, toolCount?: number): void {
    const state = this.polling.get(subAgentId);
    if (!state) return;
    state.lastHeartbeat = Date.now();
    state.status = 'running';
    if (toolCount !== undefined) state.toolCount = toolCount;
  }

  /** 完成 */
  complete(subAgentId: string): void {
    const state = this.polling.get(subAgentId);
    if (!state) return;
    state.status = 'completed';
    this.emitStatus(state);
  }

  /** 失败 */
  fail(subAgentId: string): void {
    const state = this.polling.get(subAgentId);
    if (!state) return;
    state.status = 'failed';
    this.emitStatus(state);
  }

  /** 注销 */
  unregister(subAgentId: string): void {
    this.polling.delete(subAgentId);
  }

  /** 设置状态变更回调 */
  setOnStatusChange(cb: (event: SubAgentStatusEvent) => void): void {
    this.onStatusChange = cb;
  }

  /** 启动事件泵 */
  start(): void {
    this.stop();
    // 500ms 轮询：采集状态并推送
    this.pollTimer = setInterval(() => this.poll(), this.pollIntervalMs);
    // 2s 心跳检测：标记超时子代理
    this.heartbeatTimer = setInterval(() => this.detectStale(), this.heartbeatTimeoutMs);
    logger.info('pump:started', {
      pollIntervalMs: this.pollIntervalMs,
      heartbeatTimeoutMs: this.heartbeatTimeoutMs,
    });
  }

  /** 停止 */
  stop(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  /** 500ms 轮询：推送活跃状态 */
  private poll(): void {
    const now = Date.now();
    for (const [, state] of this.polling) {
      if (state.status !== 'running') continue;
      this.emitStatus(state);
    }
  }

  /** 2s 心跳检测：标记超时 */
  private detectStale(): void {
    const now = Date.now();
    for (const [id, state] of this.polling) {
      if (state.status !== 'running') continue;
      if (now - state.lastHeartbeat > this.heartbeatTimeoutMs) {
        state.status = 'stale';
        logger.warn('pump:stale', { subAgentId: id, lastHeartbeat: state.lastHeartbeat });
        this.emitStatus(state);
      }
    }
  }

  private emitStatus(state: SubAgentHeartbeatState): void {
    const event: SubAgentStatusEvent = {
      type: 'subagent_status',
      subAgentId: state.subAgentId,
      status: state.status,
      timestamp: Date.now(),
      toolCount: state.toolCount,
      elapsedMs: Date.now() - state.startedAt,
    };
    try {
      this.onStatusChange?.(event);
    } catch {
      // callback 失败不阻断轮询
    }
  }

  /** 获取当前活跃子代理数 */
  get activeCount(): number {
    let count = 0;
    for (const [, s] of this.polling) {
      if (s.status === 'running') count++;
    }
    return count;
  }

  /** 获取指定子代理状态 */
  getState(subAgentId: string): SubAgentHeartbeatState | undefined {
    return this.polling.get(subAgentId);
  }
}

/** 全局单例 */
let _pump: SubAgentEventPump | null = null;

export function getSubAgentEventPump(): SubAgentEventPump {
  if (!_pump) _pump = new SubAgentEventPump();
  return _pump;
}
