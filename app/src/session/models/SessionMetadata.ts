/**
 * PR链接信息
 */
export interface PrLink {
  number: number;
  url: string;
  repository: string;
}

/**
 * 会话元数据接口
 */
export interface SessionMetadata {
  title: string;
  tags: string[];
  mode: string;
  model?: string;
  workspaceId?: string;
  providerId?: string;
  tasksOverride?: unknown;
  worktreeState?: any;
  prLink?: PrLink;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    costStatus: 'unknown' | 'estimated' | 'actual';
    lastPromptTokens: number;
  };
  sessionSource?: {
    userId: string;
    source: string;
    chatType: string;
    routingId: string;
  };
}

/**
 * 会话元数据类
 */
export class SessionMetadata implements SessionMetadata {
  /**
   * 创建一个新的会话元数据实例
   * @param title 会话标题
   * @param tags 会话标签
   * @param mode 会话模式
   * @param worktreeState 工作树状态
   * @param prLink PR链接信息
   */
  constructor(
    public title: string,
    public tags: string[] = [],
    public mode: string = 'default',
    public worktreeState?: any,
    public prLink?: PrLink,
    public tokenUsage?: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      reasoningTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
      costStatus: 'unknown' | 'estimated' | 'actual';
      lastPromptTokens: number;
    },
    public sessionSource?: {
      userId: string;
      source: string;
      chatType: string;
      routingId: string;
    }
  ) {}

  addTag(tag: string): void {
    if (!this.tags.includes(tag)) {
      this.tags.push(tag);
    }
  }

  removeTag(tag: string): void {
    this.tags = this.tags.filter((t) => t !== tag);
  }

  setPrLink(prLink: PrLink): void {
    this.prLink = prLink;
  }

  clearPrLink(): void {
    this.prLink = undefined;
  }

  toJSON(): object {
    return {
      title: this.title,
      tags: this.tags,
      mode: this.mode,
      worktreeState: this.worktreeState,
      prLink: this.prLink,
      ...(this.tokenUsage ? { tokenUsage: this.tokenUsage } : {}),
      ...(this.sessionSource ? { sessionSource: this.sessionSource } : {}),
    };
  }

  static fromJSON(data: any): SessionMetadata {
    return new SessionMetadata(
      data.title,
      data.tags || [],
      data.mode || 'default',
      data.worktreeState,
      data.prLink,
      data.tokenUsage,
      data.sessionSource
    );
  }
}
