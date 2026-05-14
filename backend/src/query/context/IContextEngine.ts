/**
 * 可插拔上下文引擎接口
 * 对标 Hermes agent/context_engine.py 的 ContextEngine ABC
 * 定义上下文压缩、摘要和管理的抽象契约
 */

import type { ChatMessage } from '../../ai/models/types';

/**
 * 压缩配置
 */
export interface CompressionConfig {
  /** 保护前 N 条消息不被压缩 */
  protectFirstN: number;
  /** 保护后 N 条消息不被压缩 */
  protectLastN: number;
  /** 上下文占用阈值（超过此比例触发压缩） */
  thresholdPercent: number;
  /** 摘要预算占比（摘要占上下文的比例） */
  summaryRatio: number;
  /** 摘要 Token 上限 */
  summaryTokensCeiling: number;
  /** 失败冷却时间（毫秒） */
  failureCooldownMs: number;
  /** 图片 Token 估算等价值 */
  imageCharEquivalent: number;
}

/**
 * 默认压缩配置
 */
export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  protectFirstN: 3,
  protectLastN: 6,
  thresholdPercent: 0.75,
  summaryRatio: 0.2,
  summaryTokensCeiling: 12000,
  failureCooldownMs: 600_000,
  imageCharEquivalent: 6400,
};

/**
 * 压缩结果
 */
export interface CompressionResult {
  /** 压缩后的消息列表 */
  messages: ChatMessage[];
  /** 摘要文本 */
  summary: string;
  /** 原始 Token 数 */
  originalTokens: number;
  /** 压缩后 Token 数 */
  compressedTokens: number;
  /** 节省的 Token 数 */
  tokensSaved: number;
  /** 是否发生了压缩 */
  compressed: boolean;
  /** 被压缩的消息数量 */
  truncatedCount: number;
}

/**
 * 可插拔上下文引擎接口
 */
export interface IContextEngine {
  /** 引擎标识 */
  readonly id: string;

  /**
   * 检查是否需要压缩
   * @param totalTokens 当前上下文总 Token 数
   * @param maxTokens 最大 Token 数
   * @returns 是否需要压缩
   */
  shouldCompress(totalTokens: number, maxTokens: number): boolean;

  /**
   * 压缩消息列表
   * @param messages 原始消息列表
   * @param maxTokens 最大 Token 数
   * @returns 压缩结果
   */
  compress(
    messages: ChatMessage[],
    maxTokens: number
  ): Promise<CompressionResult>;

  /**
   * 获取压缩配置
   * @returns 压缩配置
   */
  getConfig(): CompressionConfig;

  /**
   * 更新压缩配置
   * @param config 新配置
   */
  updateConfig(config: Partial<CompressionConfig>): void;

  /**
   * 获取可用 Token 预算
   * @param maxTokens 最大 Token 数
   * @param currentTokens 当前 Token 数
   * @returns 可用 Token 数
   */
  getAvailableBudget(maxTokens: number, currentTokens: number): number;

  /**
   * 计算摘要 Token 预算
   * @param availableTokens 可用 Token 数
   * @returns 摘要 Token 预算
   */
  getSummaryBudget(availableTokens: number): number;
}
