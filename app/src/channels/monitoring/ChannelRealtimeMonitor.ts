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
import type { IChannelPlugin } from '../types/IChannel';

const logger = getLogger('channels:monitor');

/**
 * 监控可观测的最小渠道视图
 *
 * 部署级渠道来自 `channelRegistry`（`ChannelInterface`），租户级通道是
 * `IChannelPlugin`（**不注册进 registry**，见 `setupChannels`）—— 两者形状不同，
 * 但监控只需要"类型 / 启用 / 已连接 / 状态快照"四项，故在此投影成同一视图。
 */
interface MonitoredChannelView {
  type: string;
  enabled: boolean;
  connected: boolean;
  getStatus(): unknown;
}

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
  /**
   * 连续探测失败计数（BUG-04 遗留加固，2026-10-05）。
   *
   * 进程忙/GC 阻塞时（单线程 JS，心跳处理与探测共用被阻塞的事件循环）心跳 ACK
   * 长时间不更新 ⇒ 探测判"不健康"，但连接实际存活。故**单次失败不判死**：
   * 仅 `healthy===false && channel.connected` 时递增；`healthy===true` 清零；
   * 超时（不确定态）不改。
   */
  consecutiveProbeFailures: number;
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
  /**
   * 单次健康探测的超时（ms，默认 3000，BUG-04 遗留加固 2026-10-05）。
   * 超时视为**不确定态**（`healthy=null`，本轮不参与判定）——防慢探测阻塞 probeAll，
   * 也避免进程忙时误判为死链。
   */
  healthCheckTimeoutMs: number;
  /** 连续探测失败达该阈值才转入 error 并自愈（默认 2，防忙时单次/瞬时误判） */
  maxConsecutiveProbeFailures: number;
}

const DEFAULT_CONFIG: ChannelRealtimeMonitorConfig = {
  probeIntervalMs: 5000,
  reconnectBaseMs: 2000,
  reconnectMaxMs: 300000,
  maxErrorSnapshot: 2000,
  healthCheckTimeoutMs: 3000,
  maxConsecutiveProbeFailures: 2,
};

export class ChannelRealtimeMonitor {
  private readonly config: ChannelRealtimeMonitorConfig;
  private readonly states = new Map<string, ChannelStateEntry>();
  /**
   * 租户通道实例（多租户 P3）：`<ownerKey>::<type>` → 插件
   *
   * 这些实例由 `setupChannels` 在**归属者身份作用域**内连接，且**不注册进
   * `channelRegistry`**（避免按 name 反查时串到部署级实例）⇒ 监控器必须单独持有引用，
   * 否则租户通道的健康状态与断连在监控面/事件流里完全不可见。
   */
  private readonly tenantChannels = new Map<string, IChannelPlugin>();
  /**
   * 租户通道的**自愈重连执行器**（由 `setupChannels` 注入，多租户 P3）。
   *
   * 监控器只有 `<ownerKey>::<type>` 这个键、**不持有凭据**：重连必须在归属者身份
   * 作用域内重新解析该租户的凭据再 `connect`，属 `setupChannels` 的职责。
   * 未注入 ⇒ 保持改造前语义（只探测、不自愈）。
   */
  private tenantReconnector: ((channelId: string) => Promise<boolean>) | null =
    null;
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

  // ─── 租户实例登记（多租户 P3）─────────────────────────

  /**
   * 登记一个租户通道实例（由 `setupChannels` 在连接成功后调用，**幂等**）
   *
   * @param channelId `<ownerKey>::<type>`（与 setupChannels 的实例命名同构）
   */
  registerTenantChannel(channelId: string, plugin: IChannelPlugin): void {
    this.tenantChannels.set(channelId, plugin);
    const entry = this.ensureEntry(channelId);
    // 登记发生在"连接成功之后" ⇒ 连接过即置 everConnected（自愈边界：只拉起连过的实例）
    if (plugin.lifecycle.getStatus().connected) {
      entry.everConnected = true;
    }
    logger.info(`监控器跟踪租户通道: ${channelId}`);
  }

  /**
   * 注入/清空租户通道自愈重连执行器（`setupChannels` 注入，**幂等**）
   *
   * @param fn `<ownerKey>::<type>` ⇒ 是否已重新连通；`null` ⇒ 关闭租户自愈
   */
  setTenantReconnector(
    fn: ((channelId: string) => Promise<boolean>) | null
  ): void {
    this.tenantReconnector = fn;
  }

  /** 注销租户通道实例（断开/删除租户时调用，**幂等**）*/
  unregisterTenantChannel(channelId: string): void {
    if (!this.tenantChannels.delete(channelId)) return;
    this.clearReconnectTimer(channelId);
    this.states.delete(channelId);
    logger.info(`监控器移除租户通道: ${channelId}`);
  }

  // ─── 状态查询 ──────────────────────────────────────────

  /** 全部渠道实时状态快照（部署级 + 租户级） */
  getStatusAll(): ChannelRuntimeStatusInfo[] {
    const deployLevel = channelRegistry
      .getAll()
      .map((ch) => this.buildStatusInfo(ch.name));
    const tenantLevel = [...this.tenantChannels.keys()].map((id) =>
      this.buildStatusInfo(id)
    );
    return [...deployLevel, ...tenantLevel];
  }

  /** 单渠道实时状态快照（先查部署级，再查租户级） */
  getChannelStatus(channelId: string): ChannelRuntimeStatusInfo | null {
    if (!this.resolveView(channelId)) return null;
    return this.buildStatusInfo(channelId);
  }

  /**
   * 把"部署级渠道 / 租户插件"统一投影为监控视图
   *
   * 找不到（既不在 registry 也不在租户表）⇒ `undefined`（调用方按"不存在"处理）。
   */
  private resolveView(channelId: string): MonitoredChannelView | undefined {
    const plugin = this.tenantChannels.get(channelId);
    if (plugin) {
      return {
        type: plugin.id,
        // 租户实例的生命周期由 `setupChannels` 管：登记进监控即代表"该租户已启用该通道"
        enabled: true,
        connected: plugin.lifecycle.getStatus().connected,
        getStatus: () => plugin.lifecycle.getStatus(),
      };
    }
    const channel = channelRegistry.get(channelId);
    if (!channel) return undefined;
    return {
      type: channel.type ?? channelId,
      enabled: channel.enabled,
      connected: channel.connected,
      getStatus: () => channel.getStatus(),
    };
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

    // 租户通道（多租户 P3）：健康探测 + 状态/事件投影；不健康达阈值时，若
    // `setupChannels` 注入了 `tenantReconnector` 则退避自愈重连 —— 监控器**不解析凭据**，
    // 重连在归属者身份作用域内由 setupChannels 执行（见 `attemptTenantReconnect`）。
    for (const channelId of this.tenantChannels.keys()) {
      try {
        await this.probeTenantOnce(channelId);
      } catch (error) {
        await handleError(error, {
          module: 'channels:monitor',
          action: 'probeTenantChannel',
          context: { channelId },
        });
      }
    }
  }

  /** 租户通道的单轮健康探测（更新内存状态 + 发事件；达阈值时才调度自愈） */
  private async probeTenantOnce(channelId: string): Promise<void> {
    const plugin = this.tenantChannels.get(channelId);
    if (!plugin) return;

    const entry = this.ensureEntry(channelId);
    const status = plugin.lifecycle.getStatus();
    const start = Date.now();

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<null>((resolve) => {
      timeoutId = setTimeout(
        () => resolve(null),
        this.config.healthCheckTimeoutMs
      );
    });
    const raced = await Promise.race([
      plugin.lifecycle.healthCheck(),
      timeoutPromise,
    ]);
    if (timeoutId) clearTimeout(timeoutId);

    // 超时 ⇒ 不确定态（不参与判定；与部署级同口径）
    entry.healthy = raced === null ? null : raced.healthy;
    entry.latencyMs =
      raced?.latencyMs && raced.latencyMs > 0
        ? raced.latencyMs
        : Date.now() - start;
    entry.lastProbeAt = Date.now();

    if (entry.healthy === true) {
      entry.everConnected = true;
      if (entry.status !== 'connected') {
        this.setStatus(channelId, 'connected', { reason: 'tenant-probe' });
      }
      entry.consecutiveProbeFailures = 0;
      return;
    }
    if (entry.healthy === false && status.connected) {
      entry.consecutiveProbeFailures += 1;
      if (
        entry.consecutiveProbeFailures >=
        this.config.maxConsecutiveProbeFailures
      ) {
        entry.lastError = '租户通道健康探测不可达';
        this.appendErrorSnapshot(channelId, '租户通道探测失败');
        this.emitEvent({
          type: 'probe_failed',
          channelId,
          timestamp: Date.now(),
          data: { latencyMs: entry.latencyMs, scope: 'tenant' },
        });
        this.setStatus(channelId, 'error', { reason: 'tenant-probe-failed' });
        // 自愈重连（仅在 setupChannels 注入执行器时；否则保持"只探测"语义）
        this.scheduleTenantReconnect(channelId);
      }
    }
  }

  /**
   * 调度租户通道的退避重连（与部署级 `scheduleReconnect` 同口径）
   *
   * 自愈边界同部署级：只拉起 `everConnected` 的实例；未注入执行器 ⇒ 直接跳过
   *（保持"只探测不自愈"）。
   */
  private scheduleTenantReconnect(channelId: string): void {
    const reconnect = this.tenantReconnector;
    if (!reconnect || !this.tenantChannels.has(channelId)) return;
    const entry = this.ensureEntry(channelId);
    if (entry.reconnectTimer || entry.reconnecting) {
      logger.debug(`租户通道重连调度跳过（已有定时器/执行中）: ${channelId}`);
      return;
    }
    if (!entry.everConnected) {
      logger.info(`租户通道重连调度跳过（从未连通过）: ${channelId}`);
      return;
    }

    entry.reconnectCount += 1;
    const delay = Math.min(
      this.config.reconnectBaseMs * 2 ** (entry.reconnectCount - 1),
      this.config.reconnectMaxMs
    );
    logger.info(`租户通道退避重连已调度: ${channelId}`, {
      attempt: entry.reconnectCount,
      delayMs: delay,
    });

    this.clearReconnectTimer(channelId);
    this.setStatus(channelId, 'reconnecting', {
      attempt: entry.reconnectCount,
      delayMs: delay,
      scope: 'tenant',
    });
    this.emitEvent({
      type: 'reconnecting',
      channelId,
      timestamp: Date.now(),
      data: { attempt: entry.reconnectCount, delayMs: delay, scope: 'tenant' },
    });

    entry.reconnectTimer = setTimeout(() => {
      entry.reconnectTimer = null;
      void this.attemptTenantReconnect(channelId);
    }, delay);
    entry.reconnectTimer.unref();
  }

  /** 执行一次租户通道重连（凭据解析在 owner 作用域内完成，由注入的执行器负责） */
  private async attemptTenantReconnect(channelId: string): Promise<void> {
    const reconnect = this.tenantReconnector;
    const plugin = this.tenantChannels.get(channelId);
    const entry = this.ensureEntry(channelId);
    if (!reconnect || !plugin) {
      this.clearReconnectTimer(channelId);
      this.setStatus(channelId, 'disconnected', { reason: 'tenant-gone' });
      return;
    }

    entry.reconnecting = true;
    logger.info(`租户通道自动重连开始: ${channelId}`, {
      attempt: entry.reconnectCount,
    });
    this.setStatus(channelId, 'connecting', { attempt: entry.reconnectCount });

    let recovered = false;
    try {
      recovered = await reconnect(channelId);
      if (recovered && plugin.lifecycle.getStatus().connected) {
        entry.reconnectCount = 0;
        entry.consecutiveProbeFailures = 0;
        entry.lastError = null;
        logger.info(`租户通道自动重连成功: ${channelId}`);
        this.setStatus(channelId, 'connected', {
          reason: 'tenant-auto-reconnect',
        });
        this.emitEvent({
          type: 'recovered',
          channelId,
          timestamp: Date.now(),
          data: { via: 'tenant-auto-reconnect', scope: 'tenant' },
        });
        return;
      }
      recovered = false;
      entry.lastError = '租户通道重连后仍未连通';
      this.appendErrorSnapshot(channelId, '租户通道重连后仍未连通');
      logger.warning(`租户通道重连后仍未连通: ${channelId}`, {
        attempt: entry.reconnectCount,
      });
      this.setStatus(channelId, 'error', { attempt: entry.reconnectCount });
    } catch (error) {
      recovered = false;
      const message = error instanceof Error ? error.message : String(error);
      entry.lastError = `租户通道重连异常: ${message}`;
      this.appendErrorSnapshot(channelId, `租户通道重连异常: ${message}`);
      await handleError(error, {
        module: 'channels:monitor',
        action: 'attemptTenantReconnect',
        context: { channelId, attempt: entry.reconnectCount },
      });
      this.setStatus(channelId, 'error', { attempt: entry.reconnectCount });
    } finally {
      entry.reconnecting = false;
    }

    // 失败 ⇒ 下一轮退避（在 `reconnecting` 复位之后调度，否则会被上面的守卫挡掉；
    // 已注销的实例由 `scheduleTenantReconnect` 的 `tenantChannels.has` 守卫拦下）
    if (!recovered) {
      this.scheduleTenantReconnect(channelId);
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

    // BUG-04 遗留加固（2026-10-05）：维护"连续探测失败"计数 ——
    // 探测健康 ⇒ 清零；"connected 但不可达" ⇒ 递增；超时不确定态 ⇒ 不变。
    if (entry.healthy === true) {
      entry.consecutiveProbeFailures = 0;
    } else if (entry.healthy === false && channel.connected) {
      entry.consecutiveProbeFailures += 1;
    }

    // 状态校正：内存态 connected 但**连续**探测不健康达阈值 → error + 自愈。
    // （单次/瞬时误判只计数不触发，避免进程忙时无谓自愈风暴；真死链下一轮即达阈值。）
    const probeFailed =
      entry.healthy === false &&
      channel.connected &&
      entry.consecutiveProbeFailures >= this.config.maxConsecutiveProbeFailures;
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
    } else if (entry.healthy === false && channel.connected) {
      // 未达连续失败阈值：仅记录，待下一轮确认（忙时单次/瞬时误判不触发自愈）
      logger.warning(
        `探测分支：内存态 connected 但探测不可达（未达连续失败阈值，暂不自愈）— ${channelId}`,
        {
          consecutiveProbeFailures: entry.consecutiveProbeFailures,
          threshold: this.config.maxConsecutiveProbeFailures,
          latencyMs: entry.latencyMs,
        }
      );
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
    healthy: boolean | null;
    latencyMs: number;
  } | null> {
    const channel = channelRegistry.get(channelId);
    if (!channel) return null;

    const entry = this.ensureEntry(channelId);
    const start = Date.now();
    let healthy: boolean | null;
    let latencyMs: number;
    let usedRealProbe = false;

    if (typeof channel.healthCheck === 'function') {
      // BUG-04 遗留加固（2026-10-05）：探测加超时 ⇒ 进程被高负载/GC 阻塞时，
      // 心跳 ACK 处理与探测同抢被阻塞的事件循环，慢探测既会阻塞 probeAll，
      // 又会被误判为死链。超时判为**不确定态**（`healthy=null`，本轮不参与判定）。
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<null>((resolve) => {
        timeoutId = setTimeout(
          () => resolve(null),
          this.config.healthCheckTimeoutMs
        );
      });
      const raced = await Promise.race([channel.healthCheck(), timeoutPromise]);
      if (timeoutId) clearTimeout(timeoutId);
      if (raced === null) {
        logger.warn(
          `渠道健康探测超时（不确定态，本轮不参与判定）: ${channelId}`,
          { timeoutMs: this.config.healthCheckTimeoutMs }
        );
        entry.healthy = null;
        entry.latencyMs = null;
        entry.lastProbeAt = Date.now();
        return { healthy: null, latencyMs: this.config.healthCheckTimeoutMs };
      }
      healthy = raced.healthy;
      latencyMs = raced.latencyMs || Date.now() - start;
      usedRealProbe = true;
    } else {
      // legacy 直注册的 ChannelInterface 无 healthCheck（Gateway 遗留通道）
      healthy = channel.connected;
      latencyMs = Date.now() - start;
    }

    entry.healthy = healthy;
    entry.latencyMs = latencyMs;
    entry.lastProbeAt = Date.now();
    if (healthy === true) {
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
        consecutiveProbeFailures: 0,
      };
      this.states.set(channelId, entry);
    }
    return entry;
  }

  /** 合并内存状态与渠道实时 getStatus()，输出快照（部署级 / 租户级同口径） */
  private buildStatusInfo(channelId: string): ChannelRuntimeStatusInfo {
    const view = this.resolveView(channelId);
    const entry = this.ensureEntry(channelId);
    const raw = view?.getStatus() as
      | (Partial<ChannelStatusLike> & Record<string, unknown>)
      | undefined;

    // 状态优先级：重连流程中的中间态 > 渠道实时 connected
    let status = entry.status;
    if (
      status !== 'connecting' &&
      status !== 'reconnecting' &&
      view?.connected &&
      status === 'disconnected'
    ) {
      status = 'connected';
    }

    return {
      channelId,
      type: view?.type ?? channelId,
      enabled: view?.enabled ?? entry.enabled,
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
