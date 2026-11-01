/**
 * Analytics模块核心管理器
 * 实现数据收集、分析和报告功能
 */

import type {
  AnalyticsEvent,
  EventMetrics,
  SessionAnalytics,
} from './types.js';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('AnalyticsManager');

export class AnalyticsManager {
  private events: AnalyticsEvent[] = [];
  private sessions: Map<string, SessionAnalytics> = new Map();
  private metrics: EventMetrics = {
    totalEvents: 0,
    eventsByType: new Map(),
    eventsBySource: new Map(),
    lastEventTime: undefined,
  };

  /**
   * 记录分析事件
   */
  async trackEvent(event: AnalyticsEvent): Promise<void> {
    this.events.push(event);
    this.updateMetrics(event);

    // 如果是异步事件，确保异步处理完成
    if (event.async) {
      await this.processAsyncEvent(event);
    }
  }

  /**
   * 开始新的分析会话
   */
  startSession(sessionId: string): void {
    const session: SessionAnalytics = {
      sessionId,
      startTime: Date.now(),
      events: [],
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      costUSD: 0,
      toolCalls: 0,
      errors: 0,
    };
    this.sessions.set(sessionId, session);
  }

  /**
   * 结束分析会话
   */
  endSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.endTime = Date.now();
    }
  }

  /**
   * 获取事件指标
   */
  getEventMetrics(): EventMetrics {
    return { ...this.metrics };
  }

  /**
   * 获取会话分析数据
   */
  getSessionAnalytics(sessionId: string): SessionAnalytics | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 获取所有会话数据
   */
  getAllSessions(): SessionAnalytics[] {
    return Array.from(this.sessions.values());
  }

  /**
   * 清空分析数据
   */
  clearData(): void {
    this.events = [];
    this.sessions.clear();
    this.metrics = {
      totalEvents: 0,
      eventsByType: new Map(),
      eventsBySource: new Map(),
      lastEventTime: undefined,
    };
  }

  /**
   * 更新事件指标
   */
  private updateMetrics(event: AnalyticsEvent): void {
    this.metrics.totalEvents++;

    // 更新事件类型统计
    const typeCount = this.metrics.eventsByType.get(event.eventName) || 0;
    this.metrics.eventsByType.set(event.eventName, typeCount + 1);

    // 更新事件源统计
    const source = (event.metadata.source as string) || 'unknown';
    const sourceCount = this.metrics.eventsBySource.get(source) || 0;
    this.metrics.eventsBySource.set(source, sourceCount + 1);

    this.metrics.lastEventTime = event.timestamp;
  }

  /**
   * 处理异步事件
   */
  private async processAsyncEvent(event: AnalyticsEvent): Promise<void> {
    // 模拟异步处理
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 这里可以添加异步事件处理逻辑
    logger.debug('处理异步事件', { eventName: event.eventName });
  }

  /**
   * 生成分析报告
   */
  generateReport(): AnalyticsReport {
    const totalSessions = this.sessions.size;
    const activeSessions = Array.from(this.sessions.values()).filter(
      (session) => !session.endTime
    ).length;

    return {
      totalEvents: this.metrics.totalEvents,
      totalSessions,
      activeSessions,
      eventDistribution: Object.fromEntries(this.metrics.eventsByType),
      sourceDistribution: Object.fromEntries(this.metrics.eventsBySource),
      lastEventTime: this.metrics.lastEventTime,
      averageSessionDuration: this.calculateAverageSessionDuration(),
      totalTokenUsage: this.calculateTotalTokenUsage(),
      totalCost: this.calculateTotalCost(),
    };
  }

  /**
   * 计算平均会话时长
   */
  private calculateAverageSessionDuration(): number {
    const completedSessions = Array.from(this.sessions.values()).filter(
      (session) => session.endTime
    );

    if (completedSessions.length === 0) return 0;

    const totalDuration = completedSessions.reduce((sum, session) => {
      return sum + ((session.endTime || 0) - session.startTime);
    }, 0);

    return totalDuration / completedSessions.length;
  }

  /**
   * 计算总令牌使用量
   */
  private calculateTotalTokenUsage(): {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } {
    const totalUsage = Array.from(this.sessions.values()).reduce(
      (sum, session) => ({
        inputTokens: sum.inputTokens + session.tokenUsage.inputTokens,
        outputTokens: sum.outputTokens + session.tokenUsage.outputTokens,
        totalTokens: sum.totalTokens + session.tokenUsage.totalTokens,
      }),
      { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    );

    return totalUsage;
  }

  /**
   * 计算总成本
   */
  private calculateTotalCost(): number {
    return Array.from(this.sessions.values()).reduce(
      (sum, session) => sum + session.costUSD,
      0
    );
  }
}

/**
 * 分析报告接口
 */
export interface AnalyticsReport {
  totalEvents: number;
  totalSessions: number;
  activeSessions: number;
  eventDistribution: Record<string, number>;
  sourceDistribution: Record<string, number>;
  lastEventTime?: number;
  averageSessionDuration: number;
  totalTokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  totalCost: number;
}
