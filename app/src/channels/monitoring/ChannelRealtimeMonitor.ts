// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * ChannelRealtimeMonitor — 渠道实时监控协调器
 *
 * 参考 LlamaCppServerManager 的监控模式，把健康探测、五态状态机、
 * 退避自愈、实时事件流、错误快照串成闭环。
 *
 * 设计文档：dev_docs/20260820/渠道实时监控实现方案.md
 *
 * 关键事实：ChannelEvents.CHANNEL_DISCONNECTED 等事件无人发布，
 * 断连感知只能依赖主动探测（本监控器的探测循环即根因方案）。
 */

import { EventEmitter } from 'events';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { channelRegistry } from '../registry/ChannelRegistry';
import { channelEventBus, ChannelEvents } from '../events/ChannelEventBus';

const logger = getLogger('channels:monitor');

/** 渠道运行时五态（对齐 llama.cpp 五态机 + reconnecting） */
export type ChannelRuntimeStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface ChannelRuntimeStatusInfo {
  channelId: string;
  type: string;
  enabled: boolean;
  status: ChannelRuntimeStatus;
  /** null = 尚未探测过 */
  healthy: boolean | null;
  latencyMs: number | null;
  lastMessageAt: number | null;
  uptimeMs: number;
  reconnectCount: number;
  lastProbeAt: number | null;
  lastError: string | null;
  /** 最近错误尾部快照（最多 2000 字符），诊断断连原因 */
  lastErrorSnapshot: string | null;
}

export type ChannelMonitorEventType =
  | 'status_change'
  | 'reconnecting'
  | 'recovered'
  | 'probe_failed';

export interface ChannelMonitorEvent {
  type: ChannelMonitorEventType;
  channelId: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

interface ChannelStateEntry {
  status: ChannelRuntimeStatus;
  enabled: boolean;
  everConnected: boolean;
  reconnectCount: number;
  healthy: boolean | null;
  latencyMs: number | null;
  lastProbeAt: number | null;
  lastError: string | null;
  lastErrorSnapshot: string;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  /** 重连执行中守卫，防止并发 connect */
  reconnecting: boolean;
}

export interface ChannelRealtimeMonitorConfig {
  /** 探测循环间隔（每渠道独立节流为此值） */
  probeIntervalMs: number;
  /** 退避基础延迟 */
  reconnectBaseMs: number;
  /** 退避上限 */
  reconnectMaxMs: number;
  /** 错误快照最大长度 */
  maxErrorSnapshot: number;
}

const DEFAULT_CONFIG: ChannelRealtimeMonitorConfig = {
  probeIntervalMs: 5000,
  reconnectBaseMs: 2000,
  reconnectMaxMs: 300000,
  maxErrorSnapshot: 2000,
};

export class ChannelRealtimeMonitor {
  private readonly config: ChannelRealtimeMonitorConfig;
  private readonly states = new Map<string, ChannelStateEntry>();
  private readonly eventEmitter = new EventEmitter();

  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private registryWired = false;
  private started = false;

  constructor(config?: Partial<ChannelRealtimeMonitorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.eventEmitter.setMaxListeners(50);
  }

  // ─── 生命周期 ──────────────────────────────────────────

  /** 启动监控（幂等）：探测循环 + registry 事件接线 */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.wireRegistryEvents();
    this.probeTimer = setInterval(
      () => void this.probeAll(),
      this.config.probeIntervalMs
    );
    this.probeTimer.unref();
    logger.info('ChannelRealtimeMonitor 已启动', {
      probeIntervalMs: this.config.probeIntervalMs,
      channels: channelRegistry.getAll().length,
    });
  }

  /** 停止监控（幂等）：清理探测循环与全部退避定时器 */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
      this.probeTimer = null;
    }
    for (const [name, entry] of this.states) {
      if (entry.reconnectTimer) {
        clearTimeout(entry.reconnectTimer);
        entry.reconnectTimer = null;
      }
      entry.reconnecting = false;
      this.states.set(name, entry);
    }
    logger.info('ChannelRealtimeMonitor 已停止');
  }

  isRunning(): boolean {
    return this.started;
  }

  // ─── 状态查询 ──────────────────────────────────────────

  /** 全部渠道实时状态快照 */
  getStatusAll(): ChannelRuntimeStatusInfo[] {
    return channelRegistry.getAll().map((ch) => this.buildStatusInfo(ch.name));
  }

  /** 单渠道实时状态快照 */
  getChannelStatus(channelId: string): ChannelRuntimeStatusInfo | null {
    const channel = channelRegistry.get(channelId);
    if (!channel) return null;
    return this.buildStatusInfo(channelId);
  }

  // ─── 事件订阅 ──────────────────────────────────────────

  /** 订阅渠道实时事件流（SSE 端点调用），返回取消订阅函数 */
  subscribeChannelEvents(
    callback: (event: ChannelMonitorEvent) => void
  ): () => void {
    this.eventEmitter.on('event', callback);
    logger.info('渠道监控事件订阅已建立', {
      listeners: this.eventEmitter.listenerCount('event'),
    });
    return () => {
      this.eventEmitter.off('event', callback);
      logger.info('渠道监控事件订阅已取消', {
        listeners: this.eventEmitter.listenerCount('event'),
      });
    };
  }

  // ─── 兜底恢复 ──────────────────────────────────────────

  /**
   * 强制重连（对齐 llama.cpp forceKill 模式）：
   * 清退避定时器 → 断开 → 等待资源释放 → 重连 → 真实探测验证
   */
  async forceReconnect(channelId: string): Promise<{
    recovered: boolean;
    error?: string;
  }> {
    const channel = channelRegistry.get(channelId);
    if (!channel) {
      return { recovered: false, error: 'Channel not found' };
    }

    const entry = this.ensureEntry(channelId);
    const t0 = Date.now();
    logger.info(`强制重连开始: ${channelId}`);
    this.clearReconnectTimer(channelId);
    this.setStatus(channelId, 'connecting', { reason: 'force-reconnect' });

    try {
      await channelRegistry.disconnect(channelId);
      logger.info(`强制重连：渠道已断开，等待 1s 资源释放 — ${channelId}`);
      // 等待 1s 让 WS/轮询等底层资源释放（对齐 forceKill 的等待验证模式）
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const ok = await channelRegistry.connect(channelId);
      const probe = ok ? await this.probeChannel(channelId) : null;
      const recovered = ok && (probe?.healthy ?? false);
      logger.info(`强制重连：connect 与探测完成 — ${channelId}`, {
        connectOk: ok,
        probeHealthy: probe?.healthy ?? null,
        probeLatencyMs: probe?.latencyMs ?? null,
        elapsedMs: Date.now() - t0,
      });
      if (recovered) {
        entry.reconnectCount = 0;
        entry.lastError = null;
        logger.info(`强制重连成功: ${channelId}`, {
          elapsedMs: Date.now() - t0,
        });
        this.setStatus(channelId, 'connected', { reason: 'force-reconnect' });
        this.emitEvent({
          type: 'recovered',
          channelId,
          timestamp: Date.now(),
          data: { via: 'force-reconnect' },
        });
      } else {
        entry.lastError = '强制重连后探测仍不健康';
        logger.warning(
          `强制重连后仍不健康，转入 error 并调度自愈 — ${channelId}`,
          {
            connectOk: ok,
            elapsedMs: Date.now() - t0,
          }
        );
        this.appendErrorSnapshot(channelId, '强制重连后探测仍不健康');
        this.setStatus(channelId, 'error', { reason: 'force-reconnect' });
        this.scheduleReconnect(channelId);
      }
      return { recovered };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warning(`强制重连异常 — ${channelId}`, {
        error: message,
        elapsedMs: Date.now() - t0,
      });
      this.appendErrorSnapshot(channelId, `强制重连异常: ${message}`);
      await handleError(error, {
        module: 'channels:monitor',
        action: 'forceReconnect',
        context: { channelId },
      });
      this.setStatus(channelId, 'error', { reason: 'force-reconnect' });
      this.scheduleReconnect(channelId);
      return { recovered: false, error: message };
    }
  }

  // ─── 内部：探测循环 ────────────────────────────────────

  private async probeAll(): Promise<void> {
    const channels = channelRegistry.getAll();
    for (const ch of channels) {
      try {
        await this.probeOnce(ch.name);
      } catch (error) {
        // 单渠道探测异常不阻断其余渠道
        await handleError(error, {
          module: 'channels:monitor',
          action: 'probeAll',
          context: { channelId: ch.name },
        });
      }
    }
  }

  /** 单轮探测：仅对 enabled 且连接过/处于重连态的渠道做真实探测 */
  private async probeOnce(channelId: string): Promise<void> {
    const channel = channelRegistry.get(channelId);
    if (!channel) return;

    const entry = this.ensureEntry(channelId);
    entry.enabled = channel.enabled;

    // 禁用的渠道：清退避定时器，回到 disconnected，不做探测
    if (!channel.enabled) {
      if (entry.status !== 'disconnected') {
        logger.info(
          `探测分支：渠道被禁用，停止自愈并回到 disconnected — ${channelId}`,
          {
            previousStatus: entry.status,
          }
        );
        this.clearReconnectTimer(channelId);
        this.setStatus(channelId, 'disconnected', { reason: 'disabled' });
      } else {
        logger.debug(`探测跳过（渠道已禁用）: ${channelId}`);
      }
      return;
    }

    // 观测到已连接 → 标记 everConnected（自愈边界：只拉起连接成功过的渠道）
    if (channel.connected && !entry.everConnected) {
      entry.everConnected = true;
      logger.info(
        `探测分支：渠道首次观测到已连接，纳入自愈范围 — ${channelId}`
      );
    }

    if (channel.connected && entry.status === 'disconnected') {
      logger.info(
        `探测分支：观测到渠道已连接（外部建立），校正为 connected — ${channelId}`
      );
      this.setStatus(channelId, 'connected', { reason: 'observed' });
    }

    // 重连等待/执行中：探测交给重连流程，跳过本轮
    if (entry.reconnectTimer || entry.reconnecting) {
      logger.debug(`探测跳过（重连流程进行中）: ${channelId}`, {
        hasTimer: !!entry.reconnectTimer,
        reconnecting: entry.reconnecting,
      });
      return;
    }
    if (!channel.connected && !entry.everConnected) {
      logger.debug(`探测跳过（从未连接成功，不纳入探测）: ${channelId}`);
      return;
    }

    await this.probeChannel(channelId);

    // 状态校正：内存态 connected 但探测不健康 → error + 自愈
    const probeFailed = entry.healthy === false && channel.connected;
    if (probeFailed) {
      entry.lastError = '渠道健康探测不可达';
      logger.warning(
        `探测分支：内存态 connected 但探测不可达，转入 error 并触发自愈 — ${channelId}`,
        {
          latencyMs: entry.latencyMs,
          previousStatus: entry.status,
          lastErrorSnapshot: entry.lastErrorSnapshot.slice(-200),
        }
      );
      this.appendErrorSnapshot(
        channelId,
        `探测失败 latency=${entry.latencyMs ?? -1}ms`
      );
      this.emitEvent({
        type: 'probe_failed',
        channelId,
        timestamp: Date.now(),
        data: { latencyMs: entry.latencyMs },
      });
      this.setStatus(channelId, 'error', { reason: 'probe-failed' });
      this.scheduleReconnect(channelId);
    } else if (entry.healthy === false && entry.status === 'error') {
      // error 态持续探测失败但无定时器（如曾因禁用被清理）→ 恢复自愈调度
      logger.info(
        `探测分支：error 态渠道无重连定时器，恢复自愈调度 — ${channelId}`,
        {
          reconnectCount: entry.reconnectCount,
        }
      );
      this.scheduleReconnect(channelId);
    } else if (
      entry.healthy === true &&
      (entry.status === 'error' || entry.status === 'reconnecting')
    ) {
      // 探测恢复健康（如网络恢复但未触发重连）→ 直接标记恢复
      logger.info(
        `探测分支：探测发现渠道已恢复健康，直接标记 connected — ${channelId}`,
        {
          previousStatus: entry.status,
          latencyMs: entry.latencyMs,
        }
      );
      entry.reconnectCount = 0;
      this.setStatus(channelId, 'connected', { reason: 'probe-recovered' });
      this.emitEvent({
        type: 'recovered',
        channelId,
        timestamp: Date.now(),
        data: { via: 'probe' },
      });
    }
  }

  /** 真实健康探测：优先 lifecycle.healthCheck()，legacy 通道回退 connected 布尔 */
  private async probeChannel(channelId: string): Promise<{
    healthy: boolean;
    latencyMs: number;
  } | null> {
    const channel = channelRegistry.get(channelId);
    if (!channel) return null;

    const entry = this.ensureEntry(channelId);
    const start = Date.now();
    let healthy: boolean;
    let latencyMs: number;
    let usedRealProbe = false;

    if (typeof channel.healthCheck === 'function') {
      const probe = await channel.healthCheck();
      healthy = probe.healthy;
      latencyMs = probe.latencyMs || Date.now() - start;
      usedRealProbe = true;
    } else {
      // legacy 直注册的 ChannelInterface 无 healthCheck（Gateway 遗留通道）
      healthy = channel.connected;
      latencyMs = Date.now() - start;
    }

    entry.healthy = healthy;
    entry.latencyMs = latencyMs;
    entry.lastProbeAt = Date.now();
    if (healthy) {
      logger.debug(`渠道探测完成（健康）: ${channelId}`, {
        healthy,
        latencyMs,
        usedRealProbe,
      });
    } else {
      logger.warning(`渠道探测不健康: ${channelId}`, {
        healthy,
        latencyMs,
        usedRealProbe,
        connected: channel.connected,
      });
    }
    return { healthy, latencyMs };
  }

  // ─── 内部：退避自愈 ────────────────────────────────────

  /**
   * 指数退避重连调度（对齐 llama.cpp onProcessExit 退避模式）
   * 自愈边界：仅 enabled 且 everConnected 的渠道
   */
  private scheduleReconnect(channelId: string): void {
    const entry = this.ensureEntry(channelId);
    if (entry.reconnectTimer || entry.reconnecting) {
      logger.debug(`重连调度跳过（已有定时器/执行中）: ${channelId}`);
      return;
    }
    if (!entry.enabled || !entry.everConnected) {
      logger.info(`重连调度跳过（不满足自愈边界）: ${channelId}`, {
        enabled: entry.enabled,
        everConnected: entry.everConnected,
      });
      return;
    }

    entry.reconnectCount += 1;
    const delay = Math.min(
      this.config.reconnectBaseMs * 2 ** (entry.reconnectCount - 1),
      this.config.reconnectMaxMs
    );

    logger.info(`渠道退避重连已调度: ${channelId}`, {
      attempt: entry.reconnectCount,
      delayMs: delay,
      baseMs: this.config.reconnectBaseMs,
      maxMs: this.config.reconnectMaxMs,
    });

    this.clearReconnectTimer(channelId);
    this.setStatus(channelId, 'reconnecting', {
      attempt: entry.reconnectCount,
      delayMs: delay,
    });
    this.emitEvent({
      type: 'reconnecting',
      channelId,
      timestamp: Date.now(),
      data: { attempt: entry.reconnectCount, delayMs: delay },
    });

    entry.reconnectTimer = setTimeout(() => {
      entry.reconnectTimer = null;
      void this.attemptReconnect(channelId);
    }, delay);
    entry.reconnectTimer.unref();
  }

  private async attemptReconnect(channelId: string): Promise<void> {
    const entry = this.ensureEntry(channelId);
    const channel = channelRegistry.get(channelId);
    if (!channel || !channel.enabled) {
      logger.info(`重连执行跳过（渠道已注销或被禁用）: ${channelId}`, {
        exists: !!channel,
        enabled: channel?.enabled ?? false,
      });
      this.clearReconnectTimer(channelId);
      this.setStatus(channelId, 'disconnected', { reason: 'gone-or-disabled' });
      return;
    }

    entry.reconnecting = true;
    logger.info(`渠道自动重连开始: ${channelId}`, {
      attempt: entry.reconnectCount,
    });
    this.setStatus(channelId, 'connecting', {
      attempt: entry.reconnectCount,
    });

    try {
      const ok = await channelRegistry.connect(channelId);
      if (ok) {
        const probe = await this.probeChannel(channelId);
        if (probe?.healthy) {
          logger.info(`渠道自动重连成功且探测健康: ${channelId}`, {
            attempt: entry.reconnectCount,
            probeLatencyMs: probe.latencyMs,
          });
          entry.reconnectCount = 0;
          entry.lastError = null;
          this.setStatus(channelId, 'connected', {
            attempt: entry.reconnectCount,
          });
          this.emitEvent({
            type: 'recovered',
            channelId,
            timestamp: Date.now(),
            data: { via: 'auto-reconnect' },
          });
          return;
        }
        logger.warning(`渠道重连成功但探测仍不健康: ${channelId}`, {
          attempt: entry.reconnectCount,
          probeLatencyMs: probe?.latencyMs ?? null,
        });
        this.appendErrorSnapshot(channelId, '重连成功但探测仍不健康');
      } else {
        logger.warning(`渠道重连失败（connect 返回 false）: ${channelId}`, {
          attempt: entry.reconnectCount,
        });
        this.appendErrorSnapshot(channelId, '重连失败（connect 返回 false）');
      }
      // 失败 → 下一轮退避
      this.setStatus(channelId, 'error', {
        attempt: entry.reconnectCount,
      });
      this.scheduleReconnect(channelId);
    } catch (error) {
      logger.warning(`渠道重连执行异常: ${channelId}`, {
        attempt: entry.reconnectCount,
        error: error instanceof Error ? error.message : String(error),
      });
      this.appendErrorSnapshot(
        channelId,
        `重连异常: ${error instanceof Error ? error.message : String(error)}`
      );
      await handleError(error, {
        module: 'channels:monitor',
        action: 'attemptReconnect',
        context: { channelId, attempt: entry.reconnectCount },
      });
      this.setStatus(channelId, 'error', {
        attempt: entry.reconnectCount,
      });
      this.scheduleReconnect(channelId);
    } finally {
      entry.reconnecting = false;
    }
  }

  // ─── 内部：状态与事件 ──────────────────────────────────

  private setStatus(
    channelId: string,
    status: ChannelRuntimeStatus,
    extra?: Record<string, unknown>
  ): void {
    const entry = this.ensureEntry(channelId);
    if (entry.status === status) return;
    const previous = entry.status;
    entry.status = status;
    logger.info(`渠道状态变更: ${channelId} ${previous} → ${status}`, extra);

    const event: ChannelMonitorEvent = {
      type: 'status_change',
      channelId,
      timestamp: Date.now(),
      data: { previous, current: status, ...extra },
    };
    this.emitEvent(event);

    // 补上"定义了但无人发布"的通道域事件（桥接层可选择性上桥）
    channelEventBus.publish(ChannelEvents.CHANNEL_STATE_CHANGE, {
      channelId,
      previous,
      current: status,
      ...extra,
    });
    if (status === 'reconnecting') {
      channelEventBus.publish(ChannelEvents.CHANNEL_RECONNECTING, {
        channelId,
        attempt: entry.reconnectCount,
      });
    }
  }

  private emitEvent(event: ChannelMonitorEvent): void {
    this.eventEmitter.emit('event', event);
  }

  private appendErrorSnapshot(channelId: string, text: string): void {
    const entry = this.ensureEntry(channelId);
    entry.lastError = text;
    const merged = `${entry.lastErrorSnapshot}\n[${new Date().toISOString()}] ${text}`;
    entry.lastErrorSnapshot = merged.slice(-this.config.maxErrorSnapshot);
  }

  private clearReconnectTimer(channelId: string): void {
    const entry = this.ensureEntry(channelId);
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }
  }

  private ensureEntry(channelId: string): ChannelStateEntry {
    let entry = this.states.get(channelId);
    if (!entry) {
      entry = {
        status: 'disconnected',
        enabled: true,
        everConnected: false,
        reconnectCount: 0,
        healthy: null,
        latencyMs: null,
        lastProbeAt: null,
        lastError: null,
        lastErrorSnapshot: '',
        reconnectTimer: null,
        reconnecting: false,
      };
      this.states.set(channelId, entry);
    }
    return entry;
  }

  /** 合并内存状态与渠道实时 getStatus()，输出快照 */
  private buildStatusInfo(channelId: string): ChannelRuntimeStatusInfo {
    const channel = channelRegistry.get(channelId);
    const entry = this.ensureEntry(channelId);
    const raw = channel?.getStatus() as
      | (Partial<ChannelStatusLike> & Record<string, unknown>)
      | undefined;

    // 状态优先级：重连流程中的中间态 > 渠道实时 connected
    let status = entry.status;
    if (
      status !== 'connecting' &&
      status !== 'reconnecting' &&
      channel?.connected &&
      status === 'disconnected'
    ) {
      status = 'connected';
    }

    return {
      channelId,
      type: channel?.type ?? channelId,
      enabled: channel?.enabled ?? entry.enabled,
      status,
      healthy: entry.healthy,
      latencyMs:
        typeof raw?.latencyMs === 'number' ? raw.latencyMs : entry.latencyMs,
      lastMessageAt:
        typeof raw?.lastMessageAt === 'number' ? raw.lastMessageAt : null,
      uptimeMs: typeof raw?.uptimeMs === 'number' ? raw.uptimeMs : 0,
      reconnectCount: entry.reconnectCount,
      lastProbeAt: entry.lastProbeAt,
      lastError: raw?.error ? String(raw.error) : entry.lastError,
      lastErrorSnapshot: entry.lastErrorSnapshot || null,
    };
  }

  /** registry 动态注册/注销接线（幂等） */
  private wireRegistryEvents(): void {
    if (this.registryWired) return;
    this.registryWired = true;

    channelRegistry.on('channel:registered', (info: { name: string }) => {
      this.ensureEntry(info.name);
      logger.info(`监控器跟踪新注册渠道: ${info.name}`);
    });
    channelRegistry.on('channel:unregistered', (info: { name: string }) => {
      this.clearReconnectTimer(info.name);
      this.states.delete(info.name);
      logger.info(`监控器移除已注销渠道: ${info.name}`);
    });
  }
}

/** getStatus() 返回的最小结构（ChannelInterface.getStatus 为 Record<string, unknown>） */
interface ChannelStatusLike {
  latencyMs?: number;
  lastMessageAt?: number;
  uptimeMs?: number;
  error?: string;
}

let _instance: ChannelRealtimeMonitor | null = null;

/** 全局单例（与 ChannelRegistry 一致的进程级唯一实例） */
export function getChannelRealtimeMonitor(): ChannelRealtimeMonitor {
  if (!_instance) {
    _instance = new ChannelRealtimeMonitor();
  }
  return _instance;
}
