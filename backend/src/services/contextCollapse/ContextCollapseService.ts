//
/**
 * ContextCollapse 上下文折叠服务
 * 基于CC源码设计原理实现
 * 通过折叠不重要的历史消息来减少token使用，同时保持细粒度
 */

import type { Message } from '@modules/chat/types/message';
import type {
  CollapseCommit,
  CollapseOptions,
  CollapseResult,
  CollapseStats,
  CollapseState,
} from './types';

const DEFAULT_OPTIONS: CollapseOptions = {
  maxTokens: 100000,
  targetReduction: 0.3,
  minMessagesToCollapse: 5,
};

export class ContextCollapseService {
  private state: Map<string, CollapseState> = new Map();
  private options: CollapseOptions;

  constructor(options?: Partial<CollapseOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * 应用折叠（如果需要）
   * @param messages 消息数组
   * @param sessionId 会话ID
   * @returns 折叠结果
   */
  async applyCollapsesIfNeeded(
    messages: Message[],
    sessionId: string
  ): Promise<CollapseResult> {
    const currentState = this.getOrCreateState(sessionId);

    const tokensBefore = this.estimateTokens(messages);

    if (tokensBefore < this.options.maxTokens * 0.8) {
      return {
        messages,
        commitsAdded: 0,
        tokensSaved: 0,
      };
    }

    const { messagesToCollapse, messagesToKeep } =
      this.selectMessagesToCollapse(messages, currentState);

    if (messagesToCollapse.length < this.options.minMessagesToCollapse) {
      return {
        messages,
        commitsAdded: 0,
        tokensSaved: 0,
      };
    }

    const summary = await this.generateSummary(messagesToCollapse);
    const commit: CollapseCommit = {
      id: `collapse-${Date.now()}`,
      timestamp: Date.now(),
      sessionId,
      collapsedMessages: messagesToCollapse.map((m) => m.id),
      summary,
    };

    currentState.commits.push(commit);
    currentState.currentView = messagesToKeep;

    const tokensAfter = this.estimateTokens(messagesToKeep);
    const tokensSaved = tokensBefore - tokensAfter;

    return {
      messages: messagesToKeep,
      commitsAdded: 1,
      tokensSaved,
    };
  }

  /**
   * 投影视图（读时投影）
   * @param sessionId 会话ID
   * @returns 投影后的消息数组
   */
  projectView(sessionId: string): Message[] {
    const state = this.state.get(sessionId);
    if (!state) {
      return [];
    }

    return state.currentView;
  }

  /**
   * 重置折叠状态
   * @param sessionId 会话ID
   */
  reset(sessionId: string): void {
    this.state.delete(sessionId);
  }

  /**
   * 获取折叠统计
   * @param sessionId 会话ID
   * @returns 统计信息
   */
  getStats(sessionId: string): CollapseStats {
    const state = this.state.get(sessionId);
    if (!state) {
      return {
        collapsedSpans: 0,
        collapsedMessages: 0,
        stagedSpans: 0,
        health: {
          totalSpawns: 0,
          totalErrors: 0,
          totalEmptySpawns: 0,
        },
      };
    }

    return {
      collapsedSpans: state.commits.length,
      collapsedMessages: state.commits.reduce(
        (sum, commit) => sum + commit.collapsedMessages.length,
        0
      ),
      stagedSpans: 0,
      health: {
        totalSpawns: state.commits.length,
        totalErrors: 0,
        totalEmptySpawns: 0,
      },
    };
  }

  /**
   * 检查是否启用
   * @returns 是否启用
   */
  isEnabled(): boolean {
    return true;
  }

  /**
   * 选择要折叠的消息
   * @param messages 所有消息
   * @param state 当前状态
   * @returns 要折叠和保留的消息
   */
  private selectMessagesToCollapse(
    messages: Message[],
    state: CollapseState
  ): { messagesToCollapse: Message[]; messagesToKeep: Message[] } {
    const alreadyCollapsedIds = new Set<string>();
    for (const commit of state.commits) {
      for (const msgId of commit.collapsedMessages) {
        alreadyCollapsedIds.add(msgId);
      }
    }

    const messagesToCollapse: Message[] = [];
    const messagesToKeep: Message[] = [];

    for (const message of messages) {
      if (alreadyCollapsedIds.has(message.id)) {
        continue;
      }

      if (this.shouldCollapseMessage(message, messages)) {
        messagesToCollapse.push(message);
      } else {
        messagesToKeep.push(message);
      }
    }

    return { messagesToCollapse, messagesToKeep };
  }

  /**
   * 判断消息是否应该被折叠
   * @param message 消息
   * @param allMessages 所有消息（用于上下文）
   * @returns 是否应该折叠
   */
  private shouldCollapseMessage(
    message: Message,
    allMessages: Message[]
  ): boolean {
    if (message.role === 'system') {
      return false;
    }

    if (message.role === 'user') {
      return false;
    }

    if ((message as any).isMeta) {
      return true;
    }

    const content = this.extractTextContent(message);
    if (!content || content.length < 50) {
      return true;
    }

    return false;
  }

  /**
   * 提取消息文本内容
   * @param message 消息
   * @returns 文本内容
   */
  private extractTextContent(message: Message): string {
    if (typeof message.content === 'string') {
      return message.content;
    }

    if (Array.isArray(message.content)) {
      return message.content
        .filter((block) => block.type === 'text')
        .map((block) => ('text' in block ? block.text : ''))
        .join('\n');
    }

    return '';
  }

  /**
   * 估算消息的token数量
   * @param messages 消息数组
   * @returns 估算的token数
   */
  private estimateTokens(messages: Message[]): number {
    let totalChars = 0;
    for (const message of messages) {
      const text = this.extractTextContent(message);
      totalChars += text.length;
    }

    return Math.ceil(totalChars / 4);
  }

  /**
   * 生成折叠摘要
   * @param messages 要折叠的消息
   * @returns 摘要文本
   */
  private async generateSummary(messages: Message[]): Promise<string> {
    const texts = messages.map((m) => this.extractTextContent(m));
    const combinedText = texts.join('\n\n');

    if (combinedText.length <= 500) {
      return combinedText;
    }

    const sentences = combinedText
      .split(/[.!?。！？]/)
      .filter((s) => s.trim().length > 10);

    const summarySentences = sentences.slice(0, 5);
    return summarySentences.join('. ') + '.';
  }

  /**
   * 获取或创建状态
   * @param sessionId 会话ID
   * @returns 状态对象
   */
  private getOrCreateState(sessionId: string): CollapseState {
    let state = this.state.get(sessionId);
    if (!state) {
      state = {
        commits: [],
        currentView: [],
      };
      this.state.set(sessionId, state);
    }
    return state;
  }
}

let contextCollapseServiceInstance: ContextCollapseService | null = null;

export function getContextCollapseService(): ContextCollapseService {
  if (!contextCollapseServiceInstance) {
    contextCollapseServiceInstance = new ContextCollapseService();
  }
  return contextCollapseServiceInstance;
}

export function isContextCollapseEnabled(): boolean {
  const service = getContextCollapseService();
  return service.isEnabled();
}

export function resetContextCollapse(): void {
  const service = getContextCollapseService();
  (service as any).state.clear();
}
