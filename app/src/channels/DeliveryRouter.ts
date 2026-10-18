/**
 * DeliveryRouter 消息投递路由器
 * 对标 Hermes gateway/ 的 DeliveryRouter
 * 支持 origin/local/指定平台 三种路由模式
 *
 * 统一出站路径：富文本支持 + 自动降级 + per-channel 串行化 + OTel 追踪
 */
import { DeliveryTarget } from './DeliveryTarget';
import { ChannelRegistry, channelRegistry } from './registry/ChannelRegistry';
import type { ChannelInterface } from './registry/ChannelRegistry';
import type { ChannelId } from './types/IChannel';

import { getLogger } from '@modules/monitoring';
import { getOTelTracing } from '../monitoring/otel/OTelTracing.js';
import {
  recordDeliverySend,
  recordDeliverySendLatency,
  recordBroadcast,
} from './monitoring/ChannelMetrics.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';
import {
  withRetry,
  RetryableError,
  type RetryConfig,
} from '@modules/utils/withRetry';
import {
  interactiveToMarkdown,
  markdownToText,
  resolveDeliveryFallbacks,
  type DeliveryFormatName,
  type DeliveryFormatSupport,
} from './deliveryFormatters';
import type { DeliveryInteractiveCard } from './deliveryTypes';

const logger = getLogger('channels:DeliveryRouter');

// ─── 类型定义 ──────────────────────────────────────────

/** 投递模式 */
export type DeliveryMode = 'origin' | 'local' | 'targeted';

/** 消息格式 */
export type DeliveryFormat = 'text' | 'markdown' | 'interactive' | 'none';

/** 交互卡片数据（类型已下沉到叶子模块 `deliveryTypes`，见该文件断环说明） */
export type { DeliveryInteractiveCard } from './deliveryTypes';

/** 投递内容（可辨识联合） */
export type DeliveryContent =
  | { format: 'text'; content: string }
  | { format: 'markdown'; content: string }
  | {
      format: 'interactive';
      card: DeliveryInteractiveCard;
      fallbackText: string;
    };

/** 投递任务 */
export interface DeliveryTask {
  target: DeliveryTarget;
  content: DeliveryContent;
  mode: DeliveryMode;
  priority: number;
}

/** 投递结果 */
export interface DeliveryResult {
  success: boolean;
  actualFormat: DeliveryFormat;
  error?: string;
  durationMs: number;
  fallbackSteps: DeliveryFormat[];
}

/** 批量投递结果 */
export interface BatchDeliveryResult {
  results: Array<{ channelId: string } & DeliveryResult>;
  totalSuccess: number;
  totalFailed: number;
}

// ─── 通道重连退避（阶段 1.4）───────────────────────────

/** 通道重连的退避重试参数（有界：最多 2 次重试，150ms 起、上限 1s；jitter 由 `withRetry` 内置） */
export const CHANNEL_RECONNECT_RETRY: Partial<RetryConfig> = {
  maxRetries: 2,
  initialDelayMs: 150,
  maxDelayMs: 1000,
};

/**
 * 带**指数退避 + jitter** 的通道重连（阶段 1.4）。
 *
 * 复用项目**标准重试实现** `utils/withRetry`（其 `calculateBackoffDelay` 已含 0–30% jitter，
 * CS01：不另写一套退避）；`connect()` 返回 `false` 视为**可重试失败**（抛 `RetryableError`
 * 触发重试），重试耗尽后抛出 ⇒ 调用方转成 `DeliveryResult{success:false}` ⇒
 * **失败只影响本次投递**，不回退主任务状态。
 */
export async function reconnectWithBackoff(
  connect: () => Promise<boolean>,
  config: Partial<RetryConfig> = CHANNEL_RECONNECT_RETRY
): Promise<boolean> {
  return withRetry(async () => {
    const ok = await connect();
    if (!ok) throw new RetryableError('通道重连返回失败');
    return true;
  }, config);
}

// ─── DeliveryRouter ────────────────────────────────────

export class DeliveryRouter {
  private registry: ChannelRegistry;
  private localOutputFn:
    | ((content: string, target?: DeliveryTarget) => void)
    | null;
  /** Per-channel 串行化锁 */
  private channelLocks = new Map<string, Promise<void>>();

  constructor(registry?: ChannelRegistry) {
    this.registry = registry || channelRegistry;
    this.localOutputFn = null;
  }

  setLocalOutput(fn: (content: string, target?: DeliveryTarget) => void): void {
    this.localOutputFn = fn;
  }

  // ── 公共方法 ──────────────────────────────────────────

  async deliverToOrigin(
    platform: ChannelId,
    conversationId: string,
    content: DeliveryContent
  ): Promise<DeliveryResult> {
    const channel = this.registry.get(platform);
    const target = DeliveryTarget.fromOrigin(platform, conversationId);

    return this._withChannelLock(platform, async () => {
      const check = await this._prepareChannel(channel);
      if (check) return check;

      const otel = getOTelTracing();
      const span = otel.startSpan('delivery.send', {
        'delivery.platform': String(platform),
        'delivery.chatId': target.chatId,
        'delivery.format': content.format,
        'delivery.content_length':
          content.format === 'interactive'
            ? content.fallbackText.length
            : content.content.length,
      });

      const startTime = Date.now();
      try {
        const result = await this._sendWithFallback(
          channel!,
          target.chatId,
          content
        );
        span.setAttributes({
          'delivery.actualFormat': result.actualFormat,
          'delivery.fallbackSteps': JSON.stringify(result.fallbackSteps),
          'delivery.success': result.success,
          'delivery.durationMs': result.durationMs,
        });
        otel.endSpan(
          span,
          result.success ? SpanStatusCode.OK : SpanStatusCode.ERROR
        );
        recordDeliverySend(String(platform), result.success);
        recordDeliverySendLatency(String(platform), Date.now() - startTime);
        return { ...result, durationMs: Date.now() - startTime };
      } catch (err) {
        otel.recordError(
          span,
          err instanceof Error ? err : new Error(String(err))
        );
        otel.endSpan(span, SpanStatusCode.ERROR);
        recordDeliverySend(String(platform), false);
        recordDeliverySendLatency(String(platform), Date.now() - startTime);
        return {
          success: false,
          actualFormat: 'none',
          error: String(err),
          durationMs: Date.now() - startTime,
          fallbackSteps: [],
        };
      }
    });
  }

  async deliverLocal(content: DeliveryContent): Promise<DeliveryResult> {
    const text =
      content.format === 'interactive' ? content.fallbackText : content.content;

    if (this.localOutputFn) {
      this.localOutputFn(text);
    } else {
      logger.info(`[LOCAL] ${text}`);
    }

    return {
      success: true,
      actualFormat: content.format === 'interactive' ? 'text' : content.format,
      durationMs: 0,
      fallbackSteps: [],
    };
  }

  async deliverToTarget(
    target: DeliveryTarget,
    content: DeliveryContent
  ): Promise<DeliveryResult> {
    const channel = this.registry.get(target.platform);

    return this._withChannelLock(target.platform, async () => {
      const check = await this._prepareChannel(channel);
      if (check) return check;

      const otel = getOTelTracing();
      const span = otel.startSpan('delivery.send', {
        'delivery.platform': String(target.platform),
        'delivery.chatId': target.chatId,
        'delivery.format': content.format,
      });
      const startTime = Date.now();

      try {
        const result = await this._sendWithFallback(
          channel!,
          target.chatId,
          content
        );
        span.setAttributes({
          'delivery.actualFormat': result.actualFormat,
          'delivery.success': result.success,
        });
        otel.endSpan(
          span,
          result.success ? SpanStatusCode.OK : SpanStatusCode.ERROR
        );
        recordDeliverySend(String(target.platform), result.success);
        recordDeliverySendLatency(
          String(target.platform),
          Date.now() - startTime
        );
        return result;
      } catch (err) {
        otel.recordError(
          span,
          err instanceof Error ? err : new Error(String(err))
        );
        otel.endSpan(span, SpanStatusCode.ERROR);
        recordDeliverySend(String(target.platform), false);
        recordDeliverySendLatency(
          String(target.platform),
          Date.now() - startTime
        );
        return {
          success: false,
          actualFormat: 'none',
          error: String(err),
          durationMs: 0,
          fallbackSteps: [],
        };
      }
    });
  }

  async broadcast(content: DeliveryContent): Promise<BatchDeliveryResult> {
    const otel = getOTelTracing();
    const span = otel.startSpan('delivery.broadcast', {
      'delivery.format': content.format,
    });

    const enabledChannels = this.registry.getEnabled();
    const results: BatchDeliveryResult['results'] = [];
    let totalSuccess = 0;
    let totalFailed = 0;

    for (const ch of enabledChannels) {
      const target = new DeliveryTarget(ch.name as ChannelId, 'broadcast');
      const result = await this.deliverToTarget(target, content);
      results.push({ channelId: ch.name, ...result });
      if (result.success) totalSuccess++;
      else totalFailed++;
    }

    span.setAttributes({
      'delivery.channelCount': enabledChannels.length,
      'delivery.totalSuccess': totalSuccess,
      'delivery.totalFailed': totalFailed,
    });
    recordBroadcast();
    otel.endSpan(span, SpanStatusCode.OK);

    return { results, totalSuccess, totalFailed };
  }

  async deliverBatch(tasks: DeliveryTask[]): Promise<BatchDeliveryResult> {
    const sortedTasks = [...tasks].sort((a, b) => b.priority - a.priority);
    const results: BatchDeliveryResult['results'] = [];
    let totalSuccess = 0;
    let totalFailed = 0;

    for (const task of sortedTasks) {
      if (task.mode === 'local') {
        const result = await this.deliverLocal(task.content);
        results.push({ channelId: 'local', ...result });
        if (result.success) totalSuccess++;
        else totalFailed++;
      } else {
        const result = await this.deliverToTarget(task.target, task.content);
        results.push({
          channelId: String(task.target.platform),
          ...result,
        });
        if (result.success) totalSuccess++;
        else totalFailed++;
      }
    }

    return { results, totalSuccess, totalFailed };
  }

  async route(
    platform: ChannelId,
    conversationId: string,
    content: DeliveryContent,
    explicitTarget?: DeliveryTarget
  ): Promise<DeliveryResult> {
    if (explicitTarget) {
      return this.deliverToTarget(explicitTarget, content);
    }
    return this.deliverToOrigin(platform, conversationId, content);
  }

  isPlatformAvailable(platform: ChannelId): boolean {
    const channel = this.registry.get(platform);
    return !!channel && channel.enabled;
  }

  getAvailablePlatforms(): ChannelId[] {
    return this.registry.getEnabled().map((ch) => ch.name as ChannelId);
  }

  // ── 私有方法 ──────────────────────────────────────────

  /** 前置检查：channel enabled + connected */
  private _checkChannel(
    channel: ChannelInterface | undefined
  ): DeliveryResult | null {
    if (!channel) {
      return {
        success: false,
        actualFormat: 'none',
        error: '通道未注册',
        durationMs: 0,
        fallbackSteps: [],
      };
    }
    if (!channel.enabled) {
      return {
        success: false,
        actualFormat: 'none',
        error: '通道已禁用',
        durationMs: 0,
        fallbackSteps: [],
      };
    }
    if (!channel.connected) {
      return {
        success: false,
        actualFormat: 'none',
        error: '通道未连接',
        durationMs: 0,
        fallbackSteps: [],
      };
    }
    return null;
  }

  /**
   * 投递前准备：检查 + 自动重连（P2-4 / 4.13；阶段 1.4 加**退避重试**）
   * 未连接通道尝试重连，成功则继续投递，避免"未连接即失败丢消息"。
   */
  private async _prepareChannel(
    channel: ChannelInterface | undefined
  ): Promise<DeliveryResult | null> {
    const check = this._checkChannel(channel);
    if (!check) return null; // 检查通过

    if (check.error === '通道未连接' && channel) {
      try {
        await reconnectWithBackoff(() => channel.connect());
        return null; // 重连成功，继续投递
      } catch (err) {
        return {
          ...check,
          error: `自动重连失败（已按退避重试）: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
    return check;
  }

  /** Per-channel 串行化：确保同一 channel 的消息按序发送 */
  private async _withChannelLock(
    channelId: string,
    fn: () => Promise<DeliveryResult>
  ): Promise<DeliveryResult> {
    const prev = (this.channelLocks.get(channelId) ?? Promise.resolve()).catch(
      () => {}
    );
    let releaseLock!: () => void;
    const nextLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const task = prev.then(fn).finally(releaseLock);
    this.channelLocks.set(channelId, nextLock);

    return task;
  }

  /** 递归降级发送 */
  private async _sendWithFallback(
    channel: ChannelInterface,
    target: string,
    content: DeliveryContent,
    fallbackSteps: DeliveryFormat[] = [],
    support?: DeliveryFormatSupport
  ): Promise<DeliveryResult> {
    // 阶段 1.2：降级链**声明驱动** —— 支持位从通道声明派生一次（缺省 true ⇒ 行为不变）
    const sup = support ?? this._formatSupport(channel);
    const result = await this._trySendFormat(
      channel,
      target,
      content,
      fallbackSteps
    );
    if (result) return result;

    const nextFormat = this._nextLowerFormat(content.format, sup);
    if (!nextFormat) {
      return {
        success: false,
        actualFormat: content.format,
        durationMs: 0,
        fallbackSteps,
      };
    }

    this._emitFallbackEvent(content.format, nextFormat);
    const converted = this._convertToFormat(content, nextFormat);
    return this._sendWithFallback(
      channel,
      target,
      converted,
      [...fallbackSteps, nextFormat],
      sup
    );
  }

  /**
   * 从通道**声明**推导降级支持（阶段 1.2）。
   *
   * 缺省 **true** ⇒ 保留既有"逐级尝试、失败再降级"语义（**零行为变更**，防回归）；
   * 仅当通道**明确声明不支持**时才跳级：
   * - `interactive` ← `channel.capabilities.interactive`
   * - `markdown`    ← `channel.meta.markdownCapable`
   *
   * B-2（2026-10-18）：只读**顶层投影字段**（`ChannelInterface.capabilities/meta`），
   * 不再穿透 `plugin.capabilities/meta`（消除第二处需同步维护的位置）。
   */
  private _formatSupport(channel: ChannelInterface): DeliveryFormatSupport {
    return {
      interactive: channel.capabilities?.interactive !== false,
      markdown: channel.meta?.markdownCapable !== false,
    };
  }

  /** 尝试当前格式发送，成功返回结果，不支持/失败返回 null */
  private async _trySendFormat(
    channel: ChannelInterface,
    target: string,
    content: DeliveryContent,
    steps: DeliveryFormat[]
  ): Promise<DeliveryResult | null> {
    // DEEP-8：每个格式分支都用 try/catch 包裹，发送方法抛异常时降级而非冒泡
    switch (content.format) {
      case 'interactive': {
        if (typeof channel.plugin?.outbound?.sendInteractive !== 'function')
          return null;
        try {
          const ok = await channel.plugin.outbound.sendInteractive(
            target,
            content.fallbackText,
            content.card as unknown as Record<string, unknown>
          );
          if (!ok) return null;
          return {
            success: true,
            actualFormat: 'interactive',
            durationMs: 0,
            fallbackSteps: steps,
          };
        } catch (err) {
          logger.warning('interactive 发送异常，降级到下一格式', {
            channel: channel.name,
            target,
            error: String(err),
          });
          return null;
        }
      }
      case 'markdown': {
        if (typeof channel.plugin?.outbound?.sendMarkdown !== 'function')
          return null;
        try {
          const ok = await channel.plugin.outbound.sendMarkdown(
            target,
            content.content
          );
          if (!ok) return null;
          return {
            success: true,
            actualFormat: 'markdown',
            durationMs: 0,
            fallbackSteps: steps,
          };
        } catch (err) {
          logger.warning('markdown 发送异常，降级到下一格式', {
            channel: channel.name,
            target,
            error: String(err),
          });
          return null;
        }
      }
      case 'text': {
        if (typeof channel.plugin?.outbound?.sendText !== 'function')
          return null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const ok = await channel.plugin.outbound.sendText(
              target,
              content.content
            );
            if (ok)
              return {
                success: true,
                actualFormat: 'text',
                durationMs: 0,
                fallbackSteps: steps,
              };
          } catch (err) {
            logger.warning('text 发送异常，重试', {
              channel: channel.name,
              target,
              attempt,
              error: String(err),
            });
          }
          if (attempt === 0) await new Promise((r) => setTimeout(r, 100));
        }
        return null;
      }
      default: {
        // TypeScript exhaustive check：确保所有 DeliveryFormat 成员都有处理
        const _exhaustive: never = content;
        throw new Error(`Unexpected format: ${String(_exhaustive)}`);
      }
    }
  }

  private _nextLowerFormat(
    f: DeliveryFormat,
    support?: DeliveryFormatSupport
  ): DeliveryFormat | null {
    // 阶段 1.2：跳过通道**声明不支持**的格式（`support` 缺省 = 全支持 ⇒ 与既有逐级尝试等价）
    const candidates = resolveDeliveryFallbacks(
      f as DeliveryFormatName,
      support ?? { interactive: true, markdown: true }
    );
    return (candidates[0] as DeliveryFormat | undefined) ?? null;
  }

  private _convertToFormat(
    content: DeliveryContent,
    targetFmt: DeliveryFormat
  ): DeliveryContent {
    if (content.format === 'interactive') {
      switch (targetFmt) {
        case 'markdown':
          return {
            format: 'markdown',
            content: interactiveToMarkdown(content.card, content.fallbackText),
          };
        case 'text':
          return { format: 'text', content: content.fallbackText };
        default:
          throw new Error(
            `Unsupported target format for interactive: ${targetFmt}`
          );
      }
    }
    if (content.format === 'markdown' && targetFmt === 'text') {
      return { format: 'text', content: markdownToText(content.content) };
    }
    return content;
  }

  private _emitFallbackEvent(
    fromFormat: DeliveryFormat,
    toFormat: DeliveryFormat
  ): void {
    try {
      const otel = getOTelTracing();
      const span = otel.getActiveSpan();
      span?.addEvent('fallback', {
        from: fromFormat,
        to: toFormat,
      });
    } catch {
      // OTel 不可用时静默跳过
    }
  }
}

// ─── 全局实例 ──────────────────────────────────────────

let globalDeliveryRouter: DeliveryRouter | null = null;

export function getDeliveryRouter(registry?: ChannelRegistry): DeliveryRouter {
  if (!globalDeliveryRouter) {
    globalDeliveryRouter = new DeliveryRouter(registry);
  }
  return globalDeliveryRouter;
}

export function resetDeliveryRouter(): void {
  globalDeliveryRouter = null;
}
