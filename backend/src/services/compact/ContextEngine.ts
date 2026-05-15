/**
 * ContextEngine 抽象基类 (ABC)
 * 对标 Hermes agent/context_engine.py
 * 定义压缩策略的统一接口，所有具体策略必须实现此接口
 */

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  createdAt: Date;
  tokenCount?: number;
  metadata?: Record<string, unknown>;
}

export interface CompactContext {
  sessionId: string;
  model: string;
  contextWindow: number;
  effectiveWindow: number;
  currentTokens: number;
  availableTokens: number;
  querySource?: string;
}

export interface CompactDecision {
  shouldCompact: boolean;
  priority: number;
  reason: string;
  tokenCount: number;
  threshold: number;
  strategyName: string;
}

export interface CompactResult {
  messages: Message[];
  originalTokenCount: number;
  compressedTokenCount: number;
  reductionRatio: number;
  preservedFirst: number;
  preservedLast: number;
  removedCount: number;
  strategyName: string;
  duration: number;
}

export interface CompactConfig {
  enabled: boolean;
  priority: number;
  protectFirstN: number;
  protectLastN: number;
  maxOutputTokens: number;
  tokenBudget: number;
  [key: string]: unknown;
}

export interface CompactMetadata {
  name: string;
  version: string;
  description: string;
  supportedRoles: string[];
}

export interface CompactStats {
  totalEvaluations: number;
  totalCompactions: number;
  totalTokensSaved: number;
  averageReductionRatio: number;
  lastCompactTime: number | null;
}

export type CompactCallback = (result: CompactResult) => void;

/**
 * ContextEngine 抽象基类
 * 所有压缩策略必须继承此类并实现其抽象方法
 */
export abstract class ContextEngine {
  protected config: CompactConfig;
  protected stats: CompactStats;
  protected listeners: Set<CompactCallback> = new Set();
  protected compactHistory: CompactResult[] = [];

  constructor(config?: Partial<CompactConfig>) {
    this.config = {
      enabled: true,
      priority: 0,
      protectFirstN: 2,
      protectLastN: 2,
      maxOutputTokens: 20000,
      tokenBudget: 50000,
      ...config,
    };

    this.stats = {
      totalEvaluations: 0,
      totalCompactions: 0,
      totalTokensSaved: 0,
      averageReductionRatio: 0,
      lastCompactTime: null,
    };
  }

  /**
   * 获取策略名称
   */
  abstract getName(): string;

  /**
   * 获取策略优先级
   */
  abstract getPriority(): number;

  /**
   * 评估是否需要压缩
   */
  abstract evaluate(messages: Message[], context: CompactContext): CompactDecision;

  /**
   * 执行压缩
   */
  abstract compact(messages: Message[], options?: Partial<CompactConfig>): CompactResult;

  /**
   * 获取策略元数据
   */
  abstract getMetadata(): CompactMetadata;

  /**
   * 检查策略是否可以处理指定消息
   */
  abstract canHandle(message: Message): boolean;

  /**
   * 配置策略
   */
  configure(config: Partial<CompactConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * 获取当前配置
   */
  getConfig(): CompactConfig {
    return { ...this.config };
  }

  /**
   * 策略是否启用
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * 设置启用状态
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * 估算可节省的 token 数
   */
  estimateTokenReduction(messages: Message[]): number {
    if (messages.length <= this.config.protectFirstN + this.config.protectLastN) {
      return 0;
    }

    const removable = messages.slice(
      this.config.protectFirstN,
      messages.length - this.config.protectLastN
    );

    return removable.reduce((sum, msg) => sum + (msg.tokenCount || 0), 0);
  }

  /**
   * 获取消息的 token 数
   */
  getMessageTokenCount(message: Message): number {
    if (message.tokenCount !== undefined) {
      return message.tokenCount;
    }

    return Math.ceil(message.content.length / 4);
  }

  /**
   * 计算消息总 token 数
   */
  getTotalTokenCount(messages: Message[]): number {
    return messages.reduce((sum, msg) => sum + this.getMessageTokenCount(msg), 0);
  }

  /**
   * 获取 token 预算
   */
  getTokenBudget(): number {
    return this.config.tokenBudget;
  }

  /**
   * 获取最大输出 token 数
   */
  getMaxOutputTokens(): number {
    return this.config.maxOutputTokens;
  }

  /**
   * 获取 protectFirstN 配置
   */
  getProtectFirstN(): number {
    return this.config.protectFirstN;
  }

  /**
   * 获取 protectLastN 配置
   */
  getProtectLastN(): number {
    return this.config.protectLastN;
  }

  /**
   * 获取策略统计
   */
  getStats(): CompactStats {
    return { ...this.stats };
  }

  /**
   * 重置策略状态
   */
  reset(): void {
    this.stats = {
      totalEvaluations: 0,
      totalCompactions: 0,
      totalTokensSaved: 0,
      averageReductionRatio: 0,
      lastCompactTime: null,
    };

    this.listeners.clear();
  }

  /**
   * 获取压缩历史
   */
  getCompactHistory(): CompactResult[] {
    return [...this.compactHistory];
  }

  /**
   * 验证压缩结果
   */
  validate(result: CompactResult): boolean {
    if (result.originalTokenCount < 0 || result.compressedTokenCount < 0) {
      return false;
    }

    if (result.reductionRatio < 0 || result.reductionRatio > 1) {
      return false;
    }

    if (result.messages.length === 0) {
      return false;
    }

    if (result.preservedFirst < 0 || result.preservedLast < 0) {
      return false;
    }

    if (result.removedCount < 0) {
      return false;
    }

    return true;
  }

  /**
   * 注册压缩完成回调
   */
  onCompact(callback: CompactCallback): void {
    this.listeners.add(callback);
  }

  /**
   * 移除压缩完成回调
   */
  offCompact(callback: CompactCallback): void {
    this.listeners.delete(callback);
  }

  /**
   * 记录评估
   */
  protected recordEvaluation(): void {
    this.stats.totalEvaluations++;
  }

  /**
   * 记录压缩结果
   */
  protected recordCompact(result: CompactResult): void {
    this.stats.totalCompactions++;
    this.stats.totalTokensSaved += result.originalTokenCount - result.compressedTokenCount;
    this.stats.totalEvaluations++;
    this.stats.lastCompactTime = Date.now();

    const totalReduction = this.stats.totalTokensSaved;
    const totalOriginal = this.stats.totalCompactions > 0
      ? (this.stats.totalTokensSaved / (1 - (result.reductionRatio || 0.01)))
      : result.originalTokenCount;

    this.stats.averageReductionRatio = totalOriginal > 0
      ? totalReduction / totalOriginal
      : 0;

    this.compactHistory.push(result);

    for (const listener of this.listeners) {
      try {
        listener(result);
      } catch {
        // 忽略回调中的错误
      }
    }
  }

  /**
   * 保护前 N 条消息
   */
  protected protectFirst(messages: Message[], n: number): Message[] {
    return messages.slice(0, Math.min(n, messages.length));
  }

  /**
   * 保护后 N 条消息
   */
  protected protectLast(messages: Message[], n: number): Message[] {
    return messages.slice(Math.max(0, messages.length - n));
  }

  /**
   * 获取可移除的消息区间
   */
  protected getRemovableRange(messages: Message[]): { start: number; end: number } | null {
    const firstN = this.config.protectFirstN;
    const lastN = this.config.protectLastN;

    if (messages.length <= firstN + lastN) {
      return null;
    }

    return {
      start: firstN,
      end: messages.length - lastN,
    };
  }
}
