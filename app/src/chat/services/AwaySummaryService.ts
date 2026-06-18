/**
 * 离开摘要服务
 * 当用户长时间离开后返回时，提供上下文摘要
 * 参考CC源码 services/awaySummary.ts 实现
 */

import type { Message } from '../types/message.js';
import { MessageRole, MessageType } from '../types/message.js';

export interface AwaySummaryConfig {
  /** 离开多少分钟后生成摘要（默认5分钟） */
  blurDelayMs: number;
  /** 回顾消息窗口大小 */
  recentMessageWindow: number;
  /** 是否启用 */
  enabled: boolean;
}

const DEFAULT_CONFIG: AwaySummaryConfig = {
  blurDelayMs: 5 * 60 * 1000,
  recentMessageWindow: 30,
  enabled: true,
};

export interface AwaySummaryResult {
  summary: string;
  generatedAt: number;
}

/**
 * 检查消息列表中是否有自上次用户消息以来的摘要
 */
export function hasSummarySinceLastUserTurn(
  messages: readonly Message[]
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'user' && !m.isMeta && !m.isCompactSummary) {
      return false;
    }
    if (m.subtype === 'away_summary') {
      return true;
    }
  }
  return false;
}

/**
 * 构建离开摘要提示
 */
function buildAwaySummaryPrompt(memory: string | null): string {
  const memoryBlock = memory
    ? `Session memory (broader context):\n${memory}\n\n`
    : '';
  return `${memoryBlock}The user stepped away and is coming back. Write exactly 1-3 short sentences. Start by stating the high-level task — what they are building or debugging, not implementation details. Next: the concrete next step. Skip status reports and commit recaps.`;
}

/**
 * 获取最近的对话消息用于摘要生成
 */
export function getRecentMessagesForSummary(
  messages: Message[],
  windowSize: number = DEFAULT_CONFIG.recentMessageWindow
): Message[] {
  return messages.slice(-windowSize);
}

/**
 * 离开摘要服务类
 */
export class AwaySummaryService {
  public config: AwaySummaryConfig;
  private lastActiveTime: number;
  private blurTimer: ReturnType<typeof setTimeout> | null = null;
  private isBlurred: boolean = false;

  constructor(config: Partial<AwaySummaryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.lastActiveTime = Date.now();
  }

  /**
   * 获取最后活跃时间
   */
  getLastActiveTime(): number {
    return this.lastActiveTime;
  }

  /**
   * 更新活跃状态
   */
  updateActiveTime(): void {
    this.lastActiveTime = Date.now();
  }

  /**
   * 处理焦点变化
   */
  handleFocusChange(state: 'focused' | 'blurred' | 'unknown'): void {
    if (state === 'blurred') {
      this.startBlurTimer();
    } else if (state === 'focused') {
      this.clearBlurTimer();
    }
  }

  /**
   * 开始离开计时器
   */
  private startBlurTimer(): void {
    if (!this.config.enabled) return;
    this.isBlurred = true;
    this.blurTimer = setTimeout(() => {
      this.onBlurTimerFire();
    }, this.config.blurDelayMs);
  }

  /**
   * 清除计时器
   */
  private clearBlurTimer(): void {
    if (this.blurTimer !== null) {
      clearTimeout(this.blurTimer);
      this.blurTimer = null;
    }
    this.isBlurred = false;
  }

  /**
   * 计时器触发时的处理
   */
  private onBlurTimerFire(): void {
    this.blurTimer = null;
  }

  /**
   * 是否应该生成摘要
   */
  shouldGenerateSummary(): boolean {
    return this.isBlurred && this.config.enabled;
  }

  /**
   * 获取离开时长（毫秒）
   */
  getAwayDuration(): number {
    return Date.now() - this.lastActiveTime;
  }

  /**
   * 检查是否可以生成摘要（离开时间足够长）
   */
  canGenerateSummary(): boolean {
    return this.getAwayDuration() >= this.config.blurDelayMs;
  }

  /**
   * 生成离开摘要（需要外部AI能力）
   * 实际使用时需要调用AI模型
   */
  async generateSummary(
    messages: Message[],
    sessionMemory: string | null = null
  ): Promise<AwaySummaryResult | null> {
    if (!this.config.enabled) {
      return null;
    }

    const recentMessages = getRecentMessagesForSummary(messages);

    if (recentMessages.length === 0) {
      return null;
    }

    const prompt = buildAwaySummaryPrompt(sessionMemory);

    return {
      summary: prompt,
      generatedAt: Date.now(),
    };
  }

  /**
   * 创建离开摘要消息
   */
  createAwaySummaryMessage(summary: string): Message {
    return {
      id: `away_summary_${Date.now()}`,
      role: MessageRole.SYSTEM,
      content: summary,
      type: MessageType.NORMAL,
      subtype: 'away_summary',
      createdAt: new Date(),
      updatedAt: new Date(),
      isMeta: false,
      isCompactSummary: false,
    };
  }

  /**
   * 销毁服务
   */
  destroy(): void {
    this.clearBlurTimer();
  }
}

export const awaySummaryService = new AwaySummaryService();
