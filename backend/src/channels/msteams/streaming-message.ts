/**
 * Microsoft Teams 流式消息模块
 * 对标 OpenClaw extensions/msteams/src/streaming-message.ts
 *
 * 使用 Teams streaminfo 实体协议实现流式消息：
 * 1. 初始块 → POST typing activity 附带 streaminfo (streamType: "streaming")
 * 2. 后续块 → POST typing activity 附带递增 streamSequence
 * 3. 最终 → POST message activity 附带 streaminfo (streamType: "final")
 */

/** 默认流更新节流间隔（毫秒） */
const DEFAULT_THROTTLE_MS = 1500;

/** 启动流式消息前的最小字符数 */
const MIN_INITIAL_CHARS = 20;

/** Teams 消息最大字符数 */
const TEAMS_MAX_CHARS = 4000;

/** 流最大存活时间（毫秒） */
const MAX_STREAM_AGE_MS = 45000;

/** 流式消息状态 */
export type TeamsStreamState = 'idle' | 'streaming' | 'finalized' | 'failed';

/** Teams 流式消息选项 */
export interface TeamsStreamOptions {
  sendActivity: (activity: Record<string, unknown>) => Promise<unknown>;
  throttleMs?: number;
  onError?: (err: unknown) => void;
}

/** 构建 streaminfo 实体 */
function buildStreamInfoEntity(
  streamId: string | undefined,
  streamType: 'informative' | 'streaming' | 'final',
  streamSequence?: number
): Record<string, unknown> {
  const entity: Record<string, unknown> = {
    type: 'streaminfo',
    streamType,
  };
  if (streamId) {
    entity.streamId = streamId;
  }
  if (streamSequence !== undefined) {
    entity.streamSequence = streamSequence;
  }
  return entity;
}

/** 从响应中提取消息 ID */
function extractActivityId(response: unknown): string | undefined {
  if (response && typeof response === 'object' && 'id' in response) {
    const id = (response as Record<string, unknown>).id;
    if (typeof id === 'string') {
      return id;
    }
  }
  return undefined;
}

/**
 * TeamsHttpStream — Teams 流式消息处理器
 *
 * 构建 typing activity 序列，逐步发送流内容，最后替换为真实消息。
 */
export class TeamsHttpStream {
  private sendActivity: (activity: Record<string, unknown>) => Promise<unknown>;
  private onError?: (err: unknown) => void;

  private accumulatedText = '';
  private streamId: string | undefined = undefined;
  private sequenceNumber = 0;
  private stopped = false;
  private finalized = false;
  private lastStreamedText = '';
  private streamState: TeamsStreamState = 'idle';
  private streamStartedAt: number | undefined = undefined;
  private throttleMs: number;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: TeamsStreamOptions) {
    this.sendActivity = options.sendActivity;
    this.onError = options.onError;
    this.throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  }

  get state(): TeamsStreamState {
    return this.streamState;
  }

  /**
   * 推送文本到流
   * 内部决定何时发送下一个 streaminfo chunk
   */
  push(text: string): void {
    if (this.stopped || this.finalized) {
      return;
    }

    this.accumulatedText += text;

    if (!this.streamStartedAt) {
      this.streamStartedAt = Date.now();
    }

    if (this.throttleTimer) {
      return;
    }

    if (this.accumulatedText.length < MIN_INITIAL_CHARS && !this.streamId) {
      return;
    }

    this.schedulePush();
  }

  /**
   * 完成流式消息，发送最终消息
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

    try {
      await this.sendFinalMessage(this.accumulatedText);
      this.streamState = 'finalized';
    } catch (err) {
      this.streamState = 'failed';
      if (this.onError) {
        this.onError(err);
      }
    }
  }

  /**
   * 停止流消息（不发送最终消息）
   */
  stop(): void {
    this.stopped = true;
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.streamState = 'idle' as TeamsStreamState;
  }

  /** 调度下一次推送 */
  private schedulePush(): void {
    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = null;

      if (this.stopped || this.finalized) {
        return;
      }

      if (this.streamStartedAt && Date.now() - this.streamStartedAt > MAX_STREAM_AGE_MS) {
        this.stopped = true;
        this.sendFinalMessage(this.accumulatedText).catch((err) => {
          if (this.onError) this.onError(err);
        });
        return;
      }

      this.pushStreamChunk(this.accumulatedText).catch((err) => {
        if (this.onError) this.onError(err);
      });
    }, this.throttleMs);
  }

  /** 推送一个 streaminfo chunk */
  private async pushStreamChunk(text: string): Promise<void> {
    const textToSend = text.slice(this.lastStreamedText.length);

    if (textToSend.length === 0) {
      return;
    }

    this.lastStreamedText = text;

    const activity: Record<string, unknown> = {
      type: 'typing',
      entities: [
        buildStreamInfoEntity(this.streamId, 'streaming', this.sequenceNumber),
      ],
    };

    try {
      const response = await this.sendActivity(activity);

      if (!this.streamId && response) {
        this.streamId = extractActivityId(response);
      }

      this.sequenceNumber++;
      this.streamState = 'streaming' as TeamsStreamState;
    } catch (err) {
      if (this.onError) {
        this.onError(err);
      }
    }
  }

  /** 发送最终消息 activity */
  private async sendFinalMessage(text: string): Promise<void> {
    const truncatedText = text.length > TEAMS_MAX_CHARS
      ? text.slice(0, TEAMS_MAX_CHARS - 100) + `\n\n...（消息已截断，共 ${text.length} 字符）`
      : text;

    const entities: Record<string, unknown>[] = [
      buildStreamInfoEntity(this.streamId, 'final'),
    ];

    const activity: Record<string, unknown> = {
      type: 'message',
      text: truncatedText,
      entities,
    };

    await this.sendActivity(activity);
  }
}
