/**
 * Matrix 流式消息模块
 * 对标 OpenClaw extensions/matrix 的流式消息模式
 *
 * 使用 Matrix room state / message editing 实现流式消息：
 * 1. 发送初始 m.text 消息
 * 2. 通过 m.replace 关系编辑更新
 * 3. 最终替换为完整内容
 */

/** 默认节流间隔（毫秒） */
import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'channels:matrix:streaming-message',
  level: LogLevel.INFO,
});

const DEFAULT_THROTTLE_MS = 1000;

/** 启动流式消息前的最小字符数 */
const MIN_INITIAL_CHARS = 15;

/** Matrix 消息最大字符数 */
const MATRIX_MAX_CHARS = 100000;

/** 流最大存活时间（毫秒） */
const MAX_STREAM_AGE_MS = 300000;

/** 流式消息状态 */
export type MatrixStreamState = 'idle' | 'streaming' | 'finalized' | 'failed';

/** Matrix 流式消息选项 */
export interface MatrixStreamOptions {
  sendMessage: (
    roomId: string,
    content: Record<string, unknown>
  ) => Promise<{ eventId?: string; error?: string }>;
  editMessage: (
    roomId: string,
    originalEventId: string,
    content: Record<string, unknown>
  ) => Promise<{ error?: string }>;
  roomId: string;
  throttleMs?: number;
  onError?: (err: unknown) => void;
}

/** 构建 Matrix 消息内容 */
function buildMessageContent(
  text: string,
  originalEventId?: string
): Record<string, unknown> {
  const content: Record<string, unknown> = {
    body: text,
    msgtype: 'm.text',
  };

  if (originalEventId) {
    content['m.new_content'] = {
      body: text,
      msgtype: 'm.text',
    };
    content['m.relates_to'] = {
      rel_type: 'm.replace',
      event_id: originalEventId,
    };
  }

  return content;
}

/**
 * MatrixStreamMessage — Matrix 流式消息处理器
 *
 * 使用 Matrix 消息编辑功能实现逐步内容展示。
 */
export class MatrixStreamMessage {
  private sendMessage: (
    roomId: string,
    content: Record<string, unknown>
  ) => Promise<{ eventId?: string; error?: string }>;
  private editMessage: (
    roomId: string,
    originalEventId: string,
    content: Record<string, unknown>
  ) => Promise<{ error?: string }>;
  private roomId: string;
  private onError?: (err: unknown) => void;

  private messageEventId: string | undefined = undefined;
  private accumulatedText = '';
  private lastStreamedText = '';
  private stopped = false;
  private finalized = false;
  private streamState: MatrixStreamState = 'idle';
  private streamStartedAt: number | undefined = undefined;
  private throttleMs: number;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: MatrixStreamOptions) {
    this.sendMessage = options.sendMessage;
    this.editMessage = options.editMessage;
    this.roomId = options.roomId;
    this.onError = options.onError;
    this.throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  }

  get state(): MatrixStreamState {
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
    this.streamState = 'streaming' as MatrixStreamState;

    try {
      const content = buildMessageContent('正在生成...');
      const result = await this.sendMessage(this.roomId, content);
      if (result.eventId) {
        this.messageEventId = result.eventId;
      }
    } catch (err) {
      this.streamState = 'failed' as MatrixStreamState;
      if (this.onError) {
        this.onError(err);
      }
    }
  }

  /**
   * 推送文本到流式消息
   */
  push(text: string): void {
    if (this.stopped || this.finalized || !this.messageEventId) {
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

    if (!this.messageEventId) {
      this.streamState = 'failed' as MatrixStreamState;
      return;
    }

    try {
      const content = buildMessageContent(
        this.truncateText(this.accumulatedText),
        this.messageEventId
      );
      await this.editMessage(this.roomId, this.messageEventId, content);
      this.streamState = 'finalized' as MatrixStreamState;
    } catch (err) {
      this.streamState = 'failed' as MatrixStreamState;
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

      if (this.stopped || this.finalized || !this.messageEventId) {
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
    if (!this.messageEventId) {
      return;
    }

    const delta = text.length - this.lastStreamedText.length;
    if (delta < 1 && this.lastStreamedText.length > 0) {
      return;
    }

    this.lastStreamedText = text;
    const content = buildMessageContent(
      this.truncateText(text),
      this.messageEventId
    );
    await this.editMessage(this.roomId, this.messageEventId, content);
  }

  /** 截断过长的文本 */
  private truncateText(text: string): string {
    if (text.length <= MATRIX_MAX_CHARS) {
      return text;
    }
    return (
      text.slice(0, MATRIX_MAX_CHARS - 100) +
      `\n\n...（消息已截断，共 ${text.length} 字符）`
    );
  }
}
