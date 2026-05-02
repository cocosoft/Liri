/**
 * PR链接信息
 */
export interface PrLink {
  /**
   * PR编号
   */
  number: number;

  /**
   * PR链接
   */
  url: string;

  /**
   * 仓库名称
   */
  repository: string;
}

/**
 * 会话元数据接口
 */
export interface SessionMetadata {
  /**
   * 会话标题
   */
  title: string;

  /**
   * 会话标签
   */
  tags: string[];

  /**
   * 会话模式
   */
  mode: string;

  /**
   * 工作树状态
   */
  worktreeState?: any;

  /**
   * PR链接信息
   */
  prLink?: PrLink;
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
    public prLink?: PrLink
  ) {}

  /**
   * 添加标签
   * @param tag 标签
   */
  addTag(tag: string): void {
    if (!this.tags.includes(tag)) {
      this.tags.push(tag);
    }
  }

  /**
   * 移除标签
   * @param tag 标签
   */
  removeTag(tag: string): void {
    this.tags = this.tags.filter((t) => t !== tag);
  }

  /**
   * 设置PR链接
   * @param prLink PR链接信息
   */
  setPrLink(prLink: PrLink): void {
    this.prLink = prLink;
  }

  /**
   * 清除PR链接
   */
  clearPrLink(): void {
    this.prLink = undefined;
  }

  /**
   * 序列化元数据
   * @returns 序列化后的元数据对象
   */
  toJSON(): object {
    return {
      title: this.title,
      tags: this.tags,
      mode: this.mode,
      worktreeState: this.worktreeState,
      prLink: this.prLink,
    };
  }

  /**
   * 从JSON创建元数据
   * @param data JSON数据
   * @returns 元数据实例
   */
  static fromJSON(data: any): SessionMetadata {
    return new SessionMetadata(
      data.title,
      data.tags || [],
      data.mode || 'default',
      data.worktreeState,
      data.prLink
    );
  }
}
