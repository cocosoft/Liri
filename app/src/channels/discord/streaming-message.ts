/**
 * Discord 流式消息模块
 * 对标 OpenClaw extensions/discord 的流式消息模式
 *
 * 使用 Discord 消息编辑 API 实现流式消息：
 * 1. 发送初始消息（显示"正在生成..."）
 * 2. 定期编辑更新消息内容
 * 3. 最终替换为完整内容
 */

/** 默认节流间隔（毫秒） */
const DEFAULT_THROTTLE_MS = 800;

/** 启动流式消息前的最小字符数 */
const MIN_INITIAL_CHARS = 10;

/** Discord 消息最大字符数 */
const DISCORD_MAX_CHARS = 2000;

/** 流最大存活时间（毫秒） */
const MAX_STREAM_AGE_MS = 900000;

/** 流式消息状态 */
export type DiscordStreamState = 'idle' | 'streaming' | 'finalized' | 'failed';

/** Discord 流式消息选项 */
export interface DiscordStreamOptions {
  sendMessage: (content: string) => Promise<{ id?: string; error?: string }>;
  editMessage: (
    messageId: string,
    content: string
  ) => Promise<{ error?: string }>;
  throttleMs?: number;
  onError?: (err: unknown) => void;
}

/**
 * DiscordStreamMessage — Discord 流式消息处理器
 *
 * 使用消息编辑实现逐步内容展示，适用于长文本生成场景。
 */
export class DiscordStreamMessage {
  private sendMessage: (
    content: string
  ) => Promise<{ id?: string; error?: string }>;
  private editMessage: (
    messageId: string,
    content: string
  ) => Promise<{ error?: string }>;
  private onError?: (err: unknown) => void;

  private messageId: string | undefined = undefined;
  private accumulatedText = '';
  private lastStreamedText = '';
  private stopped = false;
  private finalized = false;
  private streamState: DiscordStreamState = 'idle';
  private streamStartedAt: number | undefined = undefined;
  private throttleMs: number;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: DiscordStreamOptions) {
    this.sendMessage = options.sendMessage;
    this.editMessage = options.editMessage;
    this.onError = options.onError;
    this.throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  }

  get state(): DiscordStreamState {
    return this.streamState;
  }

  /**
   * 启动流式消息
   */
  async start(): Promise<void> {
    if (this.streamState !== 'idle') {
      return;
    }

    this.streamStartedAt = Date.now();
    this.streamState = 'streaming' as DiscordStreamState;

    try {
      const result = await this.sendMessage('正在生成...');
      if (result.id) {
        this.messageId = result.id;
      }
    } catch (err) {
      this.streamState = 'failed' as DiscordStreamState;
      if (this.onError) {
        this.onError(err);
      }
    }
  }

  /**
   * 推送文本到流式消息
   */
  push(text: string): void {
    if (this.stopped || this.finalized || !this.messageId) {
      return;
    }

    this.accumulatedText += text;

    if (
      this.accumulatedText.length < MIN_INITIAL_CHARS &&
      !this.lastStreamedText
    ) {
      return;
    }

    if (this.throttleTimer) {
      return;
    }

    this.scheduleUpdate();
  }

  /**
   * 完成流式消息
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
      this.streamState = 'failed' as DiscordStreamState;
      return;
    }

    try {
      await this.editMessage(
        this.messageId,
        this.truncateText(this.accumulatedText)
      );
      this.streamState = 'finalized' as DiscordStreamState;
    } catch (err) {
      this.streamState = 'failed' as DiscordStreamState;
      if (this.onError) {
        this.onError(err);
      }
    }
  }

  /**
   * 停止流式消息
   */
  stop(): void {
    this.stopped = true;
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
  }

  /** 调度下一次编辑 */
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

      this.updateMessageContent(this.accumulatedText).catch((err) => {
        if (this.onError) this.onError(err);
      });
    }, this.throttleMs);
  }

  /** 编辑消息内容 */
  private async updateMessageContent(text: string): Promise<void> {
    if (!this.messageId) {
      return;
    }

    const delta = text.length - this.lastStreamedText.length;
    if (delta < 1 && this.lastStreamedText.length > 0) {
      return;
    }

    this.lastStreamedText = text;
    await this.editMessage(this.messageId, this.truncateText(text));
  }

  /** 截断过长的文本（Discord 2000 字符限制） */
  private truncateText(text: string): string {
    if (text.length <= DISCORD_MAX_CHARS) {
      return text;
    }
    return (
      text.slice(0, DISCORD_MAX_CHARS - 100) +
      `\n\n...（消息已截断，共 ${text.length} 字符）`
    );
  }
}
