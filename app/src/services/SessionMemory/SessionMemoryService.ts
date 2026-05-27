import type { Session } from '@modules/session/models/Session';
import type { SessionMessage } from '@modules/session/models/SessionMessage';

/**
 * 会话记忆项
 */
export interface SessionMemoryItem {
  id: string;
  type: 'task' | 'insight' | 'decision' | 'action' | 'problem' | 'solution';
  content: string;
  timestamp: Date;
  relatedMessages: string[];
  importance: 'low' | 'medium' | 'high';
}

/**
 * 会话记忆摘要
 */
export interface SessionMemorySummary {
  sessionId: string;
  title: string;
  tasks: SessionMemoryItem[];
  insights: SessionMemoryItem[];
  decisions: SessionMemoryItem[];
  actions: SessionMemoryItem[];
  problems: SessionMemoryItem[];
  solutions: SessionMemoryItem[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 会话记忆服务接口
 */
export interface SessionMemoryService {
  // 创建或更新会话记忆摘要
  updateSessionSummary(
    sessionId: string,
    messages: SessionMessage[]
  ): Promise<SessionMemorySummary>;

  // 获取会话记忆摘要
  getSessionSummary(sessionId: string): Promise<SessionMemorySummary | null>;

  // 提取会话中的关键信息
  extractKeyInformation(
    messages: SessionMessage[]
  ): Promise<SessionMemoryItem[]>;

  // 为会话生成标题
  generateSessionTitle(messages: SessionMessage[]): Promise<string>;

  // 清理过期的会话记忆
  cleanupOldSessionMemory(days: number): Promise<void>;
}

/**
 * 会话记忆服务实现
 */
export class SessionMemoryServiceImpl implements SessionMemoryService {
  /**
   * 内存存储的会话记忆摘要
   */
  private sessionSummaries: Map<string, SessionMemorySummary> = new Map();

  /**
   * 创建或更新会话记忆摘要
   * @param sessionId 会话ID
   * @param messages 会话消息
   * @returns 会话记忆摘要
   */
  async updateSessionSummary(
    sessionId: string,
    messages: SessionMessage[]
  ): Promise<SessionMemorySummary> {
    // 提取关键信息
    const keyItems = await this.extractKeyInformation(messages);

    // 生成会话标题
    const title = await this.generateSessionTitle(messages);

    // 按类型分组
    const tasks = keyItems.filter((item) => item.type === 'task');
    const insights = keyItems.filter((item) => item.type === 'insight');
    const decisions = keyItems.filter((item) => item.type === 'decision');
    const actions = keyItems.filter((item) => item.type === 'action');
    const problems = keyItems.filter((item) => item.type === 'problem');
    const solutions = keyItems.filter((item) => item.type === 'solution');

    // 创建或更新摘要
    const summary: SessionMemorySummary = {
      sessionId,
      title,
      tasks,
      insights,
      decisions,
      actions,
      problems,
      solutions,
      createdAt: this.sessionSummaries.has(sessionId)
        ? this.sessionSummaries.get(sessionId)!.createdAt
        : new Date(),
      updatedAt: new Date(),
    };

    // 存储摘要
    this.sessionSummaries.set(sessionId, summary);

    return summary;
  }

  /**
   * 获取会话记忆摘要
   * @param sessionId 会话ID
   * @returns 会话记忆摘要或null
   */
  async getSessionSummary(
    sessionId: string
  ): Promise<SessionMemorySummary | null> {
    return this.sessionSummaries.get(sessionId) || null;
  }

  /**
   * 提取会话中的关键信息
   * @param messages 会话消息
   * @returns 关键信息列表
   */
  async extractKeyInformation(
    messages: SessionMessage[]
  ): Promise<SessionMemoryItem[]> {
    const items: SessionMemoryItem[] = [];

    // 简单的关键词匹配来提取关键信息
    const taskKeywords = ['task', 'todo', '需要', '要做', '任务'];
    const insightKeywords = ['insight', '发现', '注意到', '观察到'];
    const decisionKeywords = ['decision', '决定', '选择', '确定'];
    const actionKeywords = ['action', '执行', '实施', '操作'];
    const problemKeywords = ['problem', '问题', '错误', '失败'];
    const solutionKeywords = ['solution', '解决方案', '解决', '修复'];

    messages.forEach((message, index) => {
      const content = message.content.toLowerCase();

      // 检查任务
      if (taskKeywords.some((keyword) => content.includes(keyword))) {
        items.push({
          id: `task_${Date.now()}_${index}`,
          type: 'task',
          content: message.content,
          timestamp: message.timestamp,
          relatedMessages: [message.id],
          importance: this.calculateImportance(content),
        });
      }

      // 检查洞察
      if (insightKeywords.some((keyword) => content.includes(keyword))) {
        items.push({
          id: `insight_${Date.now()}_${index}`,
          type: 'insight',
          content: message.content,
          timestamp: message.timestamp,
          relatedMessages: [message.id],
          importance: this.calculateImportance(content),
        });
      }

      // 检查决定
      if (decisionKeywords.some((keyword) => content.includes(keyword))) {
        items.push({
          id: `decision_${Date.now()}_${index}`,
          type: 'decision',
          content: message.content,
          timestamp: message.timestamp,
          relatedMessages: [message.id],
          importance: this.calculateImportance(content),
        });
      }

      // 检查行动
      if (actionKeywords.some((keyword) => content.includes(keyword))) {
        items.push({
          id: `action_${Date.now()}_${index}`,
          type: 'action',
          content: message.content,
          timestamp: message.timestamp,
          relatedMessages: [message.id],
          importance: this.calculateImportance(content),
        });
      }

      // 检查问题
      if (problemKeywords.some((keyword) => content.includes(keyword))) {
        items.push({
          id: `problem_${Date.now()}_${index}`,
          type: 'problem',
          content: message.content,
          timestamp: message.timestamp,
          relatedMessages: [message.id],
          importance: this.calculateImportance(content),
        });
      }

      // 检查解决方案
      if (solutionKeywords.some((keyword) => content.includes(keyword))) {
        items.push({
          id: `solution_${Date.now()}_${index}`,
          type: 'solution',
          content: message.content,
          timestamp: message.timestamp,
          relatedMessages: [message.id],
          importance: this.calculateImportance(content),
        });
      }
    });

    return items;
  }

  /**
   * 为会话生成标题
   * @param messages 会话消息
   * @returns 会话标题
   */
  async generateSessionTitle(messages: SessionMessage[]): Promise<string> {
    if (messages.length === 0) {
      return 'Untitled Session';
    }

    // 使用第一条消息作为标题基础
    let firstMessage = messages[0].content;

    // 截取前50个字符作为标题
    if (firstMessage.length > 50) {
      firstMessage = firstMessage.substring(0, 50) + '...';
    }

    return firstMessage;
  }

  /**
   * 计算信息重要性
   * @param content 内容
   * @returns 重要性级别
   */
  private calculateImportance(content: string): 'low' | 'medium' | 'high' {
    const highKeywords = ['important', 'critical', 'urgent', '紧急', '重要'];
    const mediumKeywords = ['note', 'important', '需要注意', '注意'];

    if (highKeywords.some((keyword) => content.includes(keyword))) {
      return 'high';
    } else if (mediumKeywords.some((keyword) => content.includes(keyword))) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  /**
   * 清理过期的会话记忆
   * @param days 天数阈值
   */
  async cleanupOldSessionMemory(days: number): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    for (const [sessionId, summary] of this.sessionSummaries.entries()) {
      if (summary.updatedAt < cutoffDate) {
        this.sessionSummaries.delete(sessionId);
      }
    }
  }
}
