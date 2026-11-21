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
 * InboundAlertEvaluator — 渠道入站阈值告警（入站监视 G3/P4，2026-11-21）
 *
 * 三条规则（阈值集中在本文件顶部常量，不散落）：
 * 1. `INBOUND_REJECTION_BURST`：同一渠道 **5 分钟**内 `rejected ≥ 20` 且占比 `≥ 50%`；
 * 2. `INBOUND_INFLIGHT_STUCK`：内存缓冲里 `inflight` 超过 **5 分钟**（按渠道聚合计数）；
 * 3. `INBOUND_CHANNEL_SILENT`：已启用渠道的"最后活动"超过 **24 小时**
 *    （`lastMessageAt` 缺省时用 `uptimeMs` 反推，覆盖"连接了但一条都没收到"）。
 *
 * 边界：
 * - **观测不在判定路径上**：评估失败只留痕（`logger.warn`），不抛给调用方；
 * - **投递成功才记静默期**（`channel_alert_state` 落盘）⇒ 失败下个 tick 自然重试，重启不重复轰炸；
 * - 定时器 `unref`，`stop()` 幂等；读者（指标/缓冲/渠道态）全部可注入，便于单测。
 */

import { getLogger, getMetricsService } from '@openliri/infra/monitoring';
import { messageTraceBuffer } from './MessageTraceBuffer';
import type { MessageTraceStatus } from './messageTraceTypes';
import {
  ChannelAlertStateStore,
  getChannelAlertStateStore,
} from './ChannelAlertStateStore';

const logger = getLogger('channels:monitoring:inbound-alerts');

/** 规则 ID（同时用于静默期主键与日志） */
export type InboundAlertRuleId =
  | 'INBOUND_REJECTION_BURST'
  | 'INBOUND_INFLIGHT_STUCK'
  | 'INBOUND_CHANNEL_SILENT';

/** 拒绝率突增：窗口 / 最小条数 / 最小占比 */
export const REJECTION_WINDOW_MS = 5 * 60 * 1000;
export const REJECTION_MIN_COUNT = 20;
export const REJECTION_MIN_RATIO = 0.5;
/** inflight 卡死阈值 */
export const INFLIGHT_STUCK_MS = 5 * 60 * 1000;
/** 渠道静默阈值 */
export const CHANNEL_SILENCE_MS = 24 * 60 * 60 * 1000;
/** 默认评估周期（每分钟） */
export const EVALUATION_TICK_MS = 60 * 1000;

/**
 * 静默期（同 `(规则, 渠道)` 在该窗口内只投递一次）。
 *
 * 取值理由：拒绝突增/卡死属"正在发生的事故"，30 分钟足够让人处理又不会反复打扰；
 * 静默属低频背景状态，6 小时。
 */
export const ALERT_SILENCE_MS: Readonly<Record<InboundAlertRuleId, number>> = {
  INBOUND_REJECTION_BURST: 30 * 60 * 1000,
  INBOUND_INFLIGHT_STUCK: 30 * 60 * 1000,
  INBOUND_CHANNEL_SILENT: 6 * 60 * 60 * 1000,
};

/** 单渠道入站计数（来自 `channels.message.*` 指标累计值） */
export interface ChannelCounters {
  inbound: number;
  rejected: number;
}

/** 渠道实时态的最小投影（只取告警需要的字段） */
export interface InboundChannelStatus {
  channelId: string;
  enabled: boolean;
  lastMessageAt: number | null;
  uptimeMs: number;
}

/** 待投递的告警 */
export interface InboundAlert {
  ruleId: InboundAlertRuleId;
  channel: string;
  title: string;
  content: string;
  firedAt: number;
}

export interface InboundAlertEvaluatorOptions {
  /** 投递口（由组合根注入：收件箱 / 测试桩） */
  notify: (alert: InboundAlert) => void | Promise<void>;
  /** 静默期状态存储（测试可传临时库） */
  stateStore?: ChannelAlertStateStore;
  /** 入站计数读取（默认读 `MetricsService`） */
  counters?: () => ReadonlyMap<string, ChannelCounters>;
  /** inflight 链路读取（默认读内存缓冲） */
  inflight?: () => readonly {
    channelName: string;
    status: MessageTraceStatus;
    startedAtMs: number;
  }[];
  /** 渠道实时态读取（默认读 `ChannelRealtimeMonitor`，需要其已 `start()`） */
  channels?: () => readonly InboundChannelStatus[];
  /** 时钟（测试注入） */
  now?: () => number;
  /** 评估周期（默认 60s） */
  tickMs?: number;
}

/** 从指标键 `name{label=v,...}` 中提取标签 */
function parseLabels(labelStr: string): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const part of labelStr.split(',')) {
    const eq = part.indexOf('=');
    if (eq !== -1) labels[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return labels;
}

/**
 * 读取 `channels.message.{inbound,rejected}_total` 的**按渠道累计值**。
 *
 * 同渠道的 rejected 有多个 reason 序列 ⇒ 本函数把它们求和（告警只关心总量）。
 */
export function readChannelCounters(): ReadonlyMap<string, ChannelCounters> {
  const out = new Map<string, ChannelCounters>();
  for (const [key, metric] of getMetricsService().getAllMetrics()) {
    const matched =
      /^channels\.message\.(inbound_total|rejected_total)\{(.+)\}$/.exec(key);
    if (!matched) continue;
    const labels = parseLabels(matched[2]);
    const channel = labels.channel;
    if (!channel) continue;
    const value =
      typeof metric?.get === 'function' ? Number(metric.get()) : Number.NaN;
    if (!Number.isFinite(value)) continue;
    const current = out.get(channel) ?? { inbound: 0, rejected: 0 };
    if (matched[1] === 'inbound_total') current.inbound += value;
    else current.rejected += value;
    out.set(channel, current);
  }
  return out;
}

export class InboundAlertEvaluator {
  private readonly notify: (alert: InboundAlert) => void | Promise<void>;
  private readonly stateStore: ChannelAlertStateStore;
  private readonly readCounters: () => ReadonlyMap<string, ChannelCounters>;
  private readonly readInflight: InboundAlertEvaluatorOptions['inflight'];
  private readonly readChannels: InboundAlertEvaluatorOptions['channels'];
  private readonly now: () => number;
  private readonly tickMs: number;

  /** 拒绝率突增的上一窗口基线（进程内；窗口本身来自指标累计值） */
  private lastCounters: ReadonlyMap<string, ChannelCounters> | null = null;
  private lastCountersAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: InboundAlertEvaluatorOptions) {
    this.notify = options.notify;
    this.stateStore = options.stateStore ?? getChannelAlertStateStore();
    this.readCounters = options.counters ?? readChannelCounters;
    this.readInflight =
      options.inflight ??
      (() =>
        messageTraceBuffer.recent(500).map((trace) => ({
          channelName: trace.channelName,
          status: trace.status,
          startedAtMs: trace.startedAtMs,
        })));
    this.readChannels = options.channels;
    this.now = options.now ?? (() => Date.now());
    this.tickMs = options.tickMs ?? EVALUATION_TICK_MS;
  }

  /** 启动周期评估（幂等）；首个 tick 立刻执行（建立拒绝率基线） */
  async start(): Promise<void> {
    if (this.timer) return;
    await this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickMs);
    this.timer.unref?.();
    logger.info('入站告警评估器已启动', { tickMs: this.tickMs });
  }

  /** 停止周期评估（幂等） */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    logger.info('入站告警评估器已停止');
  }

  private async tick(): Promise<void> {
    try {
      await this.evaluateOnce(this.now());
    } catch (err) {
      // @ignore-catch 评估失败只留痕，下个周期继续（观测面不得反噬主流程）
      logger.warn('入站告警评估失败（非致命）', { error: String(err) });
    }
  }

  /**
   * 单次评估（测试与首 tick 共用）；返回**本次成功投递**的告警。
   */
  async evaluateOnce(now: number): Promise<InboundAlert[]> {
    const candidates = [
      ...this.collectRejectionBurst(now),
      ...this.collectInflightStuck(now),
      ...(await this.collectChannelSilent(now)),
    ];
    const fired: InboundAlert[] = [];
    for (const alert of candidates) {
      const silence = ALERT_SILENCE_MS[alert.ruleId];
      const allowed = await this.stateStore.shouldFire(
        alert.ruleId,
        alert.channel,
        silence,
        now
      );
      if (!allowed) continue;
      try {
        await this.notify(alert);
        // 投递成功才记静默期（失败 ⇒ 下个 tick 重试）
        await this.stateStore.markFired(alert.ruleId, alert.channel, now);
        fired.push(alert);
      } catch (err) {
        // @ignore-catch 单条投递失败不阻断其余告警
        logger.warn('入站告警投递失败（下个周期重试）', {
          ruleId: alert.ruleId,
          channel: alert.channel,
          error: String(err),
        });
      }
    }
    return fired;
  }

  /** 规则 1：拒绝率突增（窗口结束时比较累计值增量） */
  private collectRejectionBurst(now: number): InboundAlert[] {
    const current = this.readCounters();
    const previous = this.lastCounters;
    const previousAt = this.lastCountersAt;
    this.lastCounters = current;
    this.lastCountersAt = now;
    if (!previous || now - previousAt < REJECTION_WINDOW_MS) return [];

    const alerts: InboundAlert[] = [];
    for (const [channel, cur] of current) {
      const before = previous.get(channel) ?? { inbound: 0, rejected: 0 };
      const deltaInbound = Math.max(0, cur.inbound - before.inbound);
      const deltaRejected = Math.max(0, cur.rejected - before.rejected);
      if (deltaRejected < REJECTION_MIN_COUNT) continue;
      const ratio = deltaRejected / Math.max(deltaInbound, 1);
      if (ratio < REJECTION_MIN_RATIO) continue;
      alerts.push({
        ruleId: 'INBOUND_REJECTION_BURST',
        channel,
        title: `渠道入站拒绝率突增：${channel}`,
        content:
          `最近 ${Math.round(REJECTION_WINDOW_MS / 60000)} 分钟：入站 ${deltaInbound} 条，` +
          `拒绝/跳过 ${deltaRejected} 条（${Math.round(ratio * 100)}%）。` +
          `请检查渠道配置、限流与去重日志。`,
        firedAt: now,
      });
    }
    return alerts;
  }

  /** 规则 2：inflight 卡死（按渠道聚合） */
  private collectInflightStuck(now: number): InboundAlert[] {
    const inflight = this.readInflight?.() ?? [];
    const stuck = new Map<string, { count: number; oldestMs: number }>();
    for (const trace of inflight) {
      if (trace.status !== 'inflight') continue;
      const age = now - trace.startedAtMs;
      if (age <= INFLIGHT_STUCK_MS) continue;
      const current = stuck.get(trace.channelName) ?? {
        count: 0,
        oldestMs: 0,
      };
      current.count += 1;
      current.oldestMs = Math.max(current.oldestMs, age);
      stuck.set(trace.channelName, current);
    }

    return [...stuck].map(([channel, info]) => ({
      ruleId: 'INBOUND_INFLIGHT_STUCK' as const,
      channel,
      title: `渠道消息长时间未收尾：${channel}`,
      content:
        `${info.count} 条消息处于 inflight 超过 ${Math.round(
          INFLIGHT_STUCK_MS / 60000
        )} 分钟（最久 ${Math.round(info.oldestMs / 60000)} 分钟）。` +
        `可能卡在会话/LLM 往返或出站阶段，请查看消息链路。`,
      firedAt: now,
    }));
  }

  /** 规则 3：渠道静默（已启用但长时间零入站） */
  private async collectChannelSilent(now: number): Promise<InboundAlert[]> {
    const channels = this.readChannels
      ? this.readChannels()
      : await this.defaultChannelStatusReader();
    const alerts: InboundAlert[] = [];
    for (const channel of channels) {
      if (!channel.enabled) continue;
      // 无 `lastMessageAt` ⇒ 用「进程运行起点」反推（连接着但一条都没收到）
      const lastActivity = channel.lastMessageAt ?? now - channel.uptimeMs;
      const silentFor = now - lastActivity;
      if (silentFor <= CHANNEL_SILENCE_MS) continue;
      alerts.push({
        ruleId: 'INBOUND_CHANNEL_SILENT',
        channel: channel.channelId,
        title: `渠道长时间无入站：${channel.channelId}`,
        content:
          `已启用渠道 "${channel.channelId}" 已 ${Math.round(
            silentFor / 3600000
          )} 小时无入站消息。` +
          `若预期有流量，请检查 webhook / 长连接与授权状态。`,
        firedAt: now,
      });
    }
    return alerts;
  }

  /** 缺省渠道态读取：`ChannelRealtimeMonitor.getStatusAll()`（需其已 start） */
  private async defaultChannelStatusReader(): Promise<
    readonly InboundChannelStatus[]
  > {
    const { getChannelRealtimeMonitor } =
      await import('./ChannelRealtimeMonitor');
    return getChannelRealtimeMonitor()
      .getStatusAll()
      .map((info) => ({
        channelId: info.channelId,
        enabled: info.enabled,
        lastMessageAt: info.lastMessageAt,
        uptimeMs: info.uptimeMs,
      }));
  }
}
