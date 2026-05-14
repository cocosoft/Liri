import type { ReplyContext, ReplyPayload, ReplyEnvelope, ReplyResult } from './types.js';
import { createEnvelope, hasContent, mergeEnvelopes } from './envelope.js';
import { HeartbeatManager } from './heartbeat.js';
import { ReplyDispatcher } from './dispatch.js';

/**
 * ReplyOrchestrator 协调自动回复流程：
 * 1. 根据上下文构建回复负载
 * 2. 创建信封并分块
 * 3. 启动心跳（用于长时间运行）
 * 4. 分发信封到目标渠道
 */
export class ReplyOrchestrator {
  readonly dispatcher: ReplyDispatcher;
  readonly heartbeat: HeartbeatManager;

  constructor() {
    this.dispatcher = new ReplyDispatcher();
    this.heartbeat = new HeartbeatManager();
  }

  /**
   * 执行一次完整回复。
   */
  async reply(
    context: ReplyContext,
    options?: {
      heartbeatIntervalMs?: number;
      chunkLimit?: number;
    },
  ): Promise<ReplyResult> {
    const payload: ReplyPayload = {
      text: context.text,
      attachments: context.attachments,
    };

    const target = {
      channelId: context.channelId,
      accountId: context.accountId,
      conversationId: context.conversationId,
    };

    const envelope = createEnvelope(
      payload,
      {
        replyTo: context.messageId,
        conversationId: context.conversationId,
        channelId: context.channelId,
        accountId: context.accountId,
      },
      target,
    );

    if (!hasContent(envelope)) {
      return {
        sent: false,
        envelopes: [envelope],
        dispatched: [],
        error: 'No content to send',
      };
    }

    if (options?.heartbeatIntervalMs && envelope.chunks.length > 1) {
      this.heartbeat.start(options.heartbeatIntervalMs);
    }

    const dispatched = await this.dispatcher.dispatch(envelope, target);

    if (this.heartbeat.isActive()) {
      this.heartbeat.stop();
    }

    return {
      sent: dispatched.sent,
      envelopes: [envelope],
      dispatched: [dispatched],
      heartbeat: this.heartbeat.isActive() ? this.heartbeat.getState() : undefined,
      error: dispatched.error,
    };
  }

  /**
   * 批量回复多个上下文。
   */
  async replyBatch(
    contexts: ReplyContext[],
  ): Promise<ReplyResult[]> {
    return Promise.all(
      contexts.map((ctx) => this.reply(ctx)),
    );
  }

  /**
   * 分块发送长文本，每块单独创建信封。
   */
  async replyChunked(
    context: ReplyContext,
    chunkSize: number = 4000,
  ): Promise<ReplyResult> {
    const target = {
      channelId: context.channelId,
      accountId: context.accountId,
      conversationId: context.conversationId,
    };

    const envelopes: ReplyEnvelope[] = [];
    let start = 0;

    while (start < context.text.length) {
      const chunk = context.text.slice(start, start + chunkSize);
      const payload: ReplyPayload = {
        text: chunk,
        attachments: start === 0 ? context.attachments : undefined,
      };

      const envelope = createEnvelope(
        payload,
        {
          replyTo: context.messageId,
          conversationId: context.conversationId,
          channelId: context.channelId,
          accountId: context.accountId,
        },
        target,
      );

      envelopes.push(envelope);
      start += chunkSize;
    }

    if (envelopes.length === 0) {
      return {
        sent: false,
        envelopes: [],
        dispatched: [],
        error: 'No content to send',
      };
    }

    if (envelopes.length > 1) {
      this.heartbeat.start(5000);
    }

    const dispatched: Array<{ sent: boolean; envelopeId: string; chunkCount: number; error?: string }> = [];
    for (const envelope of envelopes) {
      const result = await this.dispatcher.dispatch(envelope, target);
      dispatched.push(result);
    }

    if (this.heartbeat.isActive()) {
      this.heartbeat.stop();
    }

    const allSent = dispatched.every((d) => d.sent);

    return {
      sent: allSent,
      envelopes,
      dispatched,
      heartbeat: this.heartbeat.isActive() ? this.heartbeat.getState() : undefined,
      error: allSent ? undefined : 'Some chunks failed to send',
    };
  }

  /**
   * 重置编排器状态。
   */
  reset(): void {
    this.heartbeat.reset();
    this.dispatcher.clear();
  }
}
