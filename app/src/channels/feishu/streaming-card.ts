/**
 * 飞书流式消息卡片模块
 * 对标 OpenClaw extensions/feishu/src/streaming-card.ts
 *
 * 使用飞书 Card Kit API 实现流式消息：
 * 1. 创建初始卡片（显示"正在生成..."）
 * 2. 定期更新卡片内容
 * 3. 最终替换为完整内容卡片
 */

/** 默认节流间隔（毫秒） */
import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'channels:feishu:streaming-card',
  level: LogLevel.INFO,
});

const STREAMING_UPDATE_THROTTLE_MS = 160;

/** 有意义的更新增量字符数 */
const STREAMING_SIGNIFICANT_DELTA_CHARS = 18;

/** 飞书消息最大字符数 */
const FEISHU_MAX_CHARS = 30000;

/** 流最大存活时间（毫秒） */
const MAX_STREAM_AGE_MS = 60000;

/** 流式消息状态 */
export type FeishuStreamState = 'idle' | 'streaming' | 'finalized' | 'failed';

/** 飞书流式消息选项 */
export interface FeishuStreamOptions {
  sendMessage: (
    payload: Record<string, unknown>
  ) => Promise<{ messageId?: string; error?: string }>;
  updateMessage: (
    messageId: string,
    payload: Record<string, unknown>
  ) => Promise<{ error?: string }>;
  throttleMs?: number;
  onError?: (err: unknown) => void;
}

/** 构建飞书流式消息卡片内容 */
function buildCardContent(
  text: string,
  isFinal: boolean
): Record<string, unknown> {
  return {
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      title: {
        tag: 'plain_text',
        content: isFinal ? 'AI 回复' : '正在生成...',
      },
      template: isFinal ? 'blue' : 'purple',
    },
    elements: [
      {
        tag: 'markdown',
        content: text || '（等待内容...）',
      },
    ],
  };
}

/**
 * FeishuStreamingCard — 飞书流式卡片消息处理器
 *
 * 创建可更新的交互式卡片，支持逐步显示 AI 生成内容。
 */
export class FeishuStreamingCard {
  private sendMessage: (
    payload: Record<string, unknown>
  ) => Promise<{ messageId?: string; error?: string }>;
  private updateMessage: (
    messageId: string,
    payload: Record<string, unknown>
  ) => Promise<{ error?: string }>;
  private onError?: (err: unknown) => void;

  private messageId: string | undefined = undefined;
  private accumulatedText = '';
  private lastStreamedText = '';
  private stopped = false;
  private finalized = false;
  private streamState: FeishuStreamState = 'idle';
  private streamStartedAt: number | undefined = undefined;
  private throttleMs: number;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: FeishuStreamOptions) {
    this.sendMessage = options.sendMessage;
    this.updateMessage = options.updateMessage;
    this.onError = options.onError;
    this.throttleMs = options.throttleMs ?? STREAMING_UPDATE_THROTTLE_MS;
  }

  get state(): FeishuStreamState {
    return this.streamState;
  }

  /**
   * 启动流式卡片
   */
  async start(): Promise<void> {
    if (this.streamState !== 'idle') {
      return;
    }

    this.streamStartedAt = Date.now();
    this.streamState = 'streaming' as FeishuStreamState;

    try {
      const initialCard = buildCardContent('', false);
      const result = await this.sendMessage({
        msg_type: 'interactive',
        content: JSON.stringify(initialCard),
      });

      if (result.messageId) {
        this.messageId = result.messageId;
      }
    } catch (err) {
      this.streamState = 'failed' as FeishuStreamState;
      if (this.onError) {
        this.onError(err);
      }
    }
  }

  /**
   * 推送文本到流式卡片
   */
  push(text: string): void {
    if (this.stopped || this.finalized || !this.messageId) {
      return;
    }

    this.accumulatedText += text;

    const delta = this.accumulatedText.length - this.lastStreamedText.length;
    if (delta < STREAMING_SIGNIFICANT_DELTA_CHARS && this.throttleTimer) {
      return;
    }

    if (this.throttleTimer) {
      return;
    }

    this.scheduleUpdate();
  }

  /**
   * 完成流式卡片
   */
  async finalize(): Promise<void> {
    if (this.finalized || this.stopped) {
      return;
    }

    this.stopped = true;
    this.finalized = true;

    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }

    if (!this.messageId) {
      this.streamState = 'failed' as FeishuStreamState;
      return;
    }

    try {
      const finalCard = buildCardContent(
        this.truncateText(this.accumulatedText),
        true
      );
      await this.updateMessage(this.messageId, {
        msg_type: 'interactive',
        content: JSON.stringify(finalCard),
      });
      this.streamState = 'finalized' as FeishuStreamState;
    } catch (err) {
      this.streamState = 'failed' as FeishuStreamState;
      if (this.onError) {
        this.onError(err);
      }
    }
  }

  /**
   * 停止流式卡片（不发送最终版本）
   */
  stop(): void {
    this.stopped = true;
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
  }

  /** 调度下一次卡片更新 */
  private scheduleUpdate(): void {
    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = null;

      if (this.stopped || this.finalized || !this.messageId) {
        return;
      }

      if (
        this.streamStartedAt &&
        Date.now() - this.streamStartedAt > MAX_STREAM_AGE_MS
      ) {
        this.finalize().catch((err) => {
          if (this.onError) this.onError(err);
        });
        return;
      }

      this.updateCard(this.accumulatedText).catch((err) => {
        if (this.onError) this.onError(err);
      });
    }, this.throttleMs);
  }

  /** 更新卡片内容 */
  private async updateCard(text: string): Promise<void> {
    if (!this.messageId) {
      return;
    }

    const lastStreamedLength = this.lastStreamedText.length;
    const delta = text.length - lastStreamedLength;

    if (delta < STREAMING_SIGNIFICANT_DELTA_CHARS) {
      return;
    }

    this.lastStreamedText = text;

    const card = buildCardContent(this.truncateText(text), false);
    await this.updateMessage(this.messageId, {
      msg_type: 'interactive',
      content: JSON.stringify(card),
    });
  }

  /** 截断过长的文本 */
  private truncateText(text: string): string {
    if (text.length <= FEISHU_MAX_CHARS) {
      return text;
    }
    return text.slice(0, FEISHU_MAX_CHARS - 100) + `\n\n...（消息已截断）`;
  }
}
