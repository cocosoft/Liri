/**
 * SubAgentEventPump — 子代理事件泵与心跳
 *
 * P2-13: 对标 PilotDeck subagent_status 推送 + 500ms 轮询 + 心跳检测。
 * 提供子代理运行时状态的实时推送和超时检测。
 *
 * 设计：
 *   - 500ms 轮询间隔采集子代理状态
 *   - 心跳检测超时子代理（**阈值与轮询间隔解耦**，见下）
 *   - 通过 globalEventBus 推送 subagent_status 事件
 *
 * **N-70 修复（2026-09-25，实测暴露）**：原实现把 `heartbeatTimeoutMs` 默认设为 **2s**，
 * 而该值是**轮询/推送间隔**，被误当作"心跳超时阈值" ⇒ 与真实心跳节奏（由 **LLM 单步完成点**
 * 驱动，实测间隔 **4–11s**）严重不匹配 ⇒ 每次心跳间隔超 2s 即告警，**单次 swarm 刷出 65 条
 * `pump:stale`**；且 `detectStale` 直接**改写 `status = 'stale'`** ⇒ ① 与 `heartbeat()` 回写
 * `running` 抖动；② `poll()` 只推 `running` ⇒ 标 stale 后推送中断；③ 把观测态与**终态语义**混用。
 * 现口径：**阈值默认 60s（可配置，按"单步最长耗时"量级）**、`status` **只由 heartbeat/complete/fail
 * 驱动**（detectStale 不再改写）、**同一子代理仅首次进入 stale 告警一次**（心跳恢复后重置）。
 */
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { globalEventBus } from '../core/events/EventBus.js';

const logger = getLogger('subagents:eventPump');

/** 心跳超时默认阈值（ms）——按"LLM 单步最长耗时"量级取值，**不得与轮询间隔混用** */
export const SUBAGENT_HEARTBEAT_TIMEOUT_MS = 60_000;

export interface SubAgentHeartbeatState {
  subAgentId: string;
  lastHeartbeat: number;
  /** **运行态**：只由 heartbeat/complete/fail 驱动（stale 不再写入此字段） */
  status: 'idle' | 'running' | 'completed' | 'failed';
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
  /** N-70：**派生观测**（是否超过心跳阈值）—— 不改写 `status`，仅供消费方着色/提示 */
  stale?: boolean;
}

export class SubAgentEventPump {
  private polling: Map<string, SubAgentHeartbeatState> = new Map();
  /** N-70：已就"当前这次超时"告警过的子代理（心跳恢复即清除 ⇒ 避免刷屏） */
  private staleWarned: Set<string> = new Set();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private onStatusChange: ((event: SubAgentStatusEvent) => void) | null = null;

  constructor(
    private pollIntervalMs = 500,
    private heartbeatTimeoutMs = SUBAGENT_HEARTBEAT_TIMEOUT_MS
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

  /** 心跳刷新（N-70：恢复即清除 stale 告警标记 ⇒ 后续超时可再次告警） */
  heartbeat(subAgentId: string, toolCount?: number): void {
    const state = this.polling.get(subAgentId);
    if (!state) return;
    state.lastHeartbeat = Date.now();
    state.status = 'running';
    this.staleWarned.delete(subAgentId);
    if (toolCount !== undefined) state.toolCount = toolCount;
  }

  /** 完成 */
  complete(subAgentId: string): void {
    const state = this.polling.get(subAgentId);
    if (!state) return;
    state.status = 'completed';
    this.staleWarned.delete(subAgentId);
    this.emitStatus(state);
  }

  /** 失败 */
  fail(subAgentId: string): void {
    const state = this.polling.get(subAgentId);
    if (!state) return;
    state.status = 'failed';
    this.staleWarned.delete(subAgentId);
    this.emitStatus(state);
  }

  /** 注销 */
  unregister(subAgentId: string): void {
    this.polling.delete(subAgentId);
    this.staleWarned.delete(subAgentId);
    // A 修复（2026-08-27）：polling 空时自动停止定时器，避免 setInterval 常驻进程
    if (this.polling.size === 0) {
      this.stop();
    }
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
    this.heartbeatTimer = setInterval(
      () => this.detectStale(),
      this.heartbeatTimeoutMs
    );
    logger.info('pump:started', {
      pollIntervalMs: this.pollIntervalMs,
      heartbeatTimeoutMs: this.heartbeatTimeoutMs,
    });
  }

  /** 停止 */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** 500ms 轮询：推送活跃状态（N-70：状态不再被 stale 改写 ⇒ 推送不再中断） */
  private poll(): void {
    const now = Date.now();
    for (const [, state] of this.polling) {
      if (state.status !== 'running') continue;
      this.emitStatus(state, this.isStale(state, now));
    }
  }

  /**
   * 心跳检测：识别超时子代理。
   *
   * **N-70（2026-09-25）三处口径**：① 阈值与轮询间隔**解耦**（默认 60s，见
   * `SUBAGENT_HEARTBEAT_TIMEOUT_MS`）；② **不改写 `state.status`**（`status` 只由
   * heartbeat/complete/fail 驱动 ⇒ 消除与 `heartbeat()` 的来回抖动，也避免 `poll()`
   * 因 status 被改写而**停止推送**）；③ **同一子代理仅首次告警**（心跳恢复时由
   * `heartbeat()` 清除标记），消除刷屏 —— 实测原实现单次 swarm 刷出 **65 条** `pump:stale`。
   */
  private detectStale(): void {
    const now = Date.now();
    for (const [id, state] of this.polling) {
      if (state.status !== 'running') continue;
      if (!this.isStale(state, now)) continue;
      if (this.staleWarned.has(id)) continue; // 已就本次超时告警过 ⇒ 不刷屏
      this.staleWarned.add(id);
      logger.warn('pump:stale', {
        subAgentId: id,
        lastHeartbeat: state.lastHeartbeat,
        idleMs: now - state.lastHeartbeat,
        thresholdMs: this.heartbeatTimeoutMs,
      });
      this.emitStatus(state, true);
    }
  }

  /** 是否超过心跳阈值（**只读判定、无副作用**） */
  private isStale(state: SubAgentHeartbeatState, now: number): boolean {
    return now - state.lastHeartbeat > this.heartbeatTimeoutMs;
  }

  private emitStatus(state: SubAgentHeartbeatState, stale = false): void {
    const event: SubAgentStatusEvent = {
      type: 'subagent_status',
      subAgentId: state.subAgentId,
      status: state.status,
      timestamp: Date.now(),
      toolCount: state.toolCount,
      elapsedMs: Date.now() - state.startedAt,
      // N-70：stale 作为**派生观测**随事件下发（写入 `status` 会污染运行态语义）
      ...(stale ? { stale: true } : {}),
    };
    try {
      this.onStatusChange?.(event);
      // 事件泵修复（2026-08-27）：发布到 globalEventBus（对齐注释声明）——
      // 原实现事件无消费者（setOnStatusChange 无调用点），UI/监控收不到子代理状态
      globalEventBus.publish(
        'subagent_status',
        event as unknown as Record<string, unknown>
      );
    } catch (err) {
      handleError(err, {
        module: 'subagents:eventPump',
        action: 'onStatusChange',
      });
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
