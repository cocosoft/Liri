/**
 * SlidingWindow — 滑动窗口消息裁剪
 *
 * 对标 CC_Code QueryEngine.ts 的滑动窗口模式：
 * 在每次 Agent 循环前检测 token 预算，超出时裁剪早期非关键消息，
 * 始终保留 system prompt 和最近的 N 轮对话。
 *
 * Liri 的 TAORLoop 已有 TokenBudget 预算监控 + compactIfNeeded()
 * 压缩机制，但缺乏运行前的预防性裁剪。本模块在消息发送前进行预检，
 * 避免因 Token 溢出导致的请求拒决。
 */

import { Logger, LogLevel } from '@modules/monitoring';
import type { ChatMessage } from '@modules/ai';
import { extractKeyPaths } from '@modules/agent/compact/utils';

const logger = new Logger({
  module: 'query:slidingWindow',
  level: LogLevel.INFO,
});

/**
 * 滑动窗口配置
 */
export interface SlidingWindowConfig {
  /** 保留的最近消息轮次数量 */
  keepRecentRounds: number;

  /** 最大消息条数限制（超出时触发裁剪） */
  maxMessages: number;

  /** 是否包含 tool 消息在保留窗口内 */
  keepToolMessages: boolean;

  /** 压缩后摘要前面插入标记 */
  summaryMarker: string;
}

const DEFAULT_CONFIG: SlidingWindowConfig = {
  keepRecentRounds: 10,
  maxMessages: 100,
  keepToolMessages: true,
  summaryMarker: '[以下为早期对话摘要]',
};

/**
 * 滑动窗口状态
 */
export interface SlidingWindowState {
  /** 是否执行了裁剪 */
  trimmed: boolean;

  /** 裁剪前的消息数 */
  beforeCount: number;

  /** 裁剪后的消息数 */
  afterCount: number;

  /** 被移除的早期消息摘要 */
  summary: string;
}

/**
 * SlidingWindow — 滑动窗口裁剪器
 */
export class SlidingWindow {
  private config: SlidingWindowConfig;

  constructor(config: Partial<SlidingWindowConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 检查是否需要裁剪
   */
  shouldTrim(messages: ChatMessage[]): boolean {
    return messages.length > this.config.maxMessages;
  }

  /**
   * 裁剪消息列表
   *
   * 保留策略：
   * 1. 始终保留 system prompt（第一条 system 消息）
   * 2. 保留最近的 keepRecentRounds 轮对话
   * 3. 中间消息替换为一条摘要标记
   */
  trim(messages: ChatMessage[]): {
    messages: ChatMessage[];
    state: SlidingWindowState;
  } {
    const beforeCount = messages.length;

    if (!this.shouldTrim(messages)) {
      return {
        messages,
        state: {
          trimmed: false,
          beforeCount,
          afterCount: beforeCount,
          summary: '',
        },
      };
    }

    // 提取 system prompt
    const systemMessages: ChatMessage[] = [];
    let systemIndex = -1;

    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === 'system') {
        systemMessages.push(messages[i]);
        systemIndex = i;
        break;
      }
    }

    // 保留最近 N 轮
    const keepCount = this.config.keepRecentRounds * 2;
    const recentStart = Math.max(
      systemIndex >= 0 ? systemIndex + 1 : 0,
      messages.length - keepCount
    );

    const recentMessages = messages.slice(recentStart);

    // 提取被裁剪部分的摘要（取前两条消息的摘要）
    const trimStart = systemIndex >= 0 ? systemIndex + 1 : 0;
    const trimmedSection = messages.slice(trimStart, recentStart);

    const summaryLines: string[] = [];
    for (const msg of trimmedSection) {
      const rawContent =
        typeof msg.content === 'string'
          ? msg.content
          : '';
      const content = rawContent.slice(0, 100) || '[非文本内容]';
      // 提取并保留关键路径信息
      const keyPaths = extractKeyPaths(rawContent);
      const line = keyPaths.length > 0
        ? `[${msg.role}]: ${content} (路径: ${keyPaths.join(', ')})`
        : `[${msg.role}]: ${content}`;
      summaryLines.push(line);
    }

    const summary =
      summaryLines.length > 0
        ? summaryLines.slice(0, 3).join('\n') +
          (summaryLines.length > 3
            ? `\n... 共 ${summaryLines.length} 条消息被压缩`
            : '')
        : '';

    // 构建结果：system + 摘要标记 + 最近消息
    const result: ChatMessage[] = [...systemMessages];

    if (summary) {
      result.push({
        role: 'user',
        content: `${this.config.summaryMarker}\n${summary}`,
      });
    }

    result.push(...recentMessages);

    const afterCount = result.length;

    logger.info('滑动窗口：消息裁剪完成', {
      beforeCount,
      afterCount,
      trimmedCount: beforeCount - afterCount,
    });

    return {
      messages: result,
      state: {
        trimmed: true,
        beforeCount,
        afterCount,
        summary,
      },
    };
  }
}
