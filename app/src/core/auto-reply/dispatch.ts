import type { ReplyEnvelope, DispatchTarget, DispatchResult } from './types.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'core:auto-reply:dispatch', level: LogLevel.INFO });

export type DispatchHandler = (
  envelope: ReplyEnvelope,
  target: DispatchTarget
) => Promise<DispatchResult>;

/**
 * ReplyDispatcher 负责将信封分发给目标渠道。
 * 支持注册自定义分发处理器以适配不同渠道。
 */
export class ReplyDispatcher {
  private handlers: Map<string, DispatchHandler> = new Map();
  private defaultHandler: DispatchHandler | null = null;

  /**
   * 为指定渠道注册分发处理器。
   */
  registerHandler(channelId: string, handler: DispatchHandler): void {
    this.handlers.set(channelId, handler);
  }

  /**
   * 注销指定渠道的分发处理器。
   */
  unregisterHandler(channelId: string): boolean {
    return this.handlers.delete(channelId);
  }

  /**
   * 设置默认分发处理器（用于未注册的渠道）。
   */
  setDefaultHandler(handler: DispatchHandler): void {
    this.defaultHandler = handler;
  }

  /**
   * 分发单个信封到目标。
   */
  async dispatch(
    envelope: ReplyEnvelope,
    target: DispatchTarget
  ): Promise<DispatchResult> {
    const handler = this.handlers.get(target.channelId) ?? this.defaultHandler;

    if (!handler) {
      return {
        sent: false,
        envelopeId: envelope.id,
        chunkCount: envelope.chunks.length,
        error: `No handler registered for channel: ${target.channelId}`,
      };
    }

    try {
      return await handler(envelope, target);
    } catch (err) {
      return {
        sent: false,
        envelopeId: envelope.id,
        chunkCount: envelope.chunks.length,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 批量分发多个信封。
   */
  async dispatchBatch(
    envelopes: ReplyEnvelope[],
    target: DispatchTarget
  ): Promise<DispatchResult[]> {
    return Promise.all(
      envelopes.map((envelope) => this.dispatch(envelope, target))
    );
  }

  /**
   * 检查是否有指定渠道的处理器。
   */
  hasHandler(channelId: string): boolean {
    return this.handlers.has(channelId) || this.defaultHandler !== null;
  }

  /**
   * 列出所有已注册的渠道。
   */
  listChannels(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * 清除所有处理器。
   */
  clear(): void {
    this.handlers.clear();
    this.defaultHandler = null;
  }
}
