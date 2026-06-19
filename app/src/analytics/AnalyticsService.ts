import { randomUUID } from 'node:crypto';

/**
 * 分析服务 - 负责事件追踪、会话管理等
 */
export class AnalyticsService {
  private events: any[] = [];
  private sessions: Map<string, any> = new Map();
  private eventSequence: number = 0;
  private maxEvents: number = 50000;
  private maxSessions: number = 1000;
  private sessionTimeout: number = 1800000; // 30分钟
  private toolCallCounts: Map<string, number> = new Map();
  private totalToolCalls: number = 0;
  private listeners: Map<string, Array<(...args: any[]) => void>> = new Map();
  static instance: AnalyticsService;

  /**
   * 追踪事件
   * @param type 事件类型
   * @param name 事件名称
   * @param metadata 事件元数据
   * @returns 事件ID
   */
  trackEvent(type: string, name: string, metadata: Record<string, any> = {}) {
    const eventId = randomUUID();
    const timestamp = Date.now();
    const event = {
      id: eventId,
      type,
      name,
      metadata: {
        timestamp,
        ...metadata,
      },
      timestamp,
      sequence: this.eventSequence++,
    };

    this.events.push(event);

    // 触发事件跟踪回调
    this.emit('eventTracked', event);

    // 限制事件队列大小
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    // 独立累计工具调用计数（不受队列清空影响）
    if (['tool_call', 'tool_execute', 'tool_result'].includes(type)) {
      const toolName = metadata?.tool_name || name || 'unknown';
      this.toolCallCounts.set(
        toolName,
        (this.toolCallCounts.get(toolName) || 0) + 1
      );
      this.totalToolCalls++;
    }

    return eventId;
  }

  /**
   * 记录事件（简化的接口）
   * @param eventName 事件名称
   * @param metadata 事件元数据
   * @returns 事件ID
   */
  logEvent(eventName: string, metadata: Record<string, any> = {}) {
    return this.trackEvent(eventName, eventName, metadata);
  }

  /**
   * 开始会话
   * @param userId 用户ID
   * @returns 会话ID
   */
  startSession(userId: string) {
    const sessionId = randomUUID();
    const session = {
      id: sessionId,
      startTime: Date.now(),
      lastActivity: Date.now(),
      user_id: userId,
      interactionCount: 0,
      totalDuration: 0,
      operations: [],
    };

    this.sessions.set(sessionId, session);
    return sessionId;
  }

  /**
   * 获取会话信息
   * @param sessionId 会话ID
   * @returns 会话信息
   */
  getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  /**
   * 获取所有会话
   * @returns 会话列表
   */
  getAllSessions() {
    return Array.from(this.sessions.values());
  }

  /**
   * 获取事件
   * @param options 查询选项
   * @returns 事件列表
   */
  getEvents(options: Record<string, any> = {}) {
    let result = [...this.events];

    if (options.type) {
      result = result.filter((event) => event.type === options.type);
    }

    if (options.name) {
      result = result.filter((event) => event.name === options.name);
    }

    if (options.startTime) {
      result = result.filter((event) => event.timestamp >= options.startTime);
    }

    if (options.endTime) {
      result = result.filter((event) => event.timestamp <= options.endTime);
    }

    if (options.limit) {
      result = result.slice(0, options.limit);
    }

    return result;
  }

  /**
   * 结束会话
   * @param sessionId 会话ID
   */
  endSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.endTime = Date.now();
    session.totalDuration = session.endTime - session.startTime;
    this.emit('sessionEnded', session);
  }

  /**
   * 更新会话活动
   * @param sessionId 会话ID
   * @param operationType 操作类型
   * @param duration 操作持续时间
   */
  updateSessionActivity(
    sessionId: string,
    operationType: string,
    duration: number
  ) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.lastActivity = Date.now();
    session.interactionCount++;
    session.totalDuration = session.lastActivity - session.startTime;

    let operation = session.operations.find(
      (op: any) => op.type === operationType
    );
    if (!operation) {
      operation = { type: operationType, count: 0, totalDuration: 0 };
      session.operations.push(operation);
    }

    operation.count++;
    operation.totalDuration += duration;

    this.emit('sessionUpdated', session);
  }

  /**
   * 清理过期会话
   */
  clearExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity > this.sessionTimeout) {
        this.clearSession(sessionId);
      }
    }
  }

  /**
   * 清理会话
   * @param sessionId 会话ID
   */
  clearSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.emit('sessionCleared', session);
      this.sessions.delete(sessionId);
    }
  }

  /**
   * 清除所有会话
   */
  clearAllSessions() {
    this.sessions.clear();
  }

  /**
   * 获取统计信息
   * @returns 统计信息
   */
  getStats() {
    const eventCounts: Record<string, any> = {};
    for (const event of this.events) {
      eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
    }

    return {
      totalEvents: this.events.length,
      totalSessions: this.sessions.size,
      activeSessions: this.getActiveSessions().length,
      totalToolCalls: this.totalToolCalls,
      toolCallCounts: Object.fromEntries(this.toolCallCounts),
      eventCounts,
    };
  }

  /**
   * 获取工具调用统计
   * @returns 工具调用统计
   */
  getToolCallStats(): {
    totalCalls: number;
    uniqueTools: number;
    topTools: Array<{ name: string; count: number }>;
  } {
    const sorted = [...this.toolCallCounts.entries()]
      .sort((a: [string, number], b: [string, number]) => b[1] - a[1])
      .slice(0, 10);

    return {
      totalCalls: this.totalToolCalls,
      uniqueTools: this.toolCallCounts.size,
      topTools: sorted.map(([tool, count]) => ({ name: tool, count })),
    };
  }

  /**
   * 获取活跃会话
   * @param timeout 超时时间（毫秒）
   * @returns 活跃会话列表
   */
  getActiveSessions(timeout: number = 300000) {
    const now = Date.now();
    const activeSessions: any[] = [];

    for (const session of this.sessions.values()) {
      if (now - session.lastActivity <= timeout) {
        activeSessions.push(session);
      }
    }

    return activeSessions;
  }

  /**
   * 发出事件
   * @param event 事件名称
   * @param data 事件数据
   */
  emit(event: string, data: any) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (err) {
          console.error(`事件处理器执行失败 [${event}]:`, err);
        }
      }
    }
  }

  /**
   * 注册事件监听器
   * @param event 事件名称
   * @param handler 事件处理函数
   */
  on(event: string, handler: (...args: any[]) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  /**
   * 事件计数
   */
  get eventCounts(): Record<string, any> {
    const counts: Record<string, any> = {};
    for (const event of this.events) {
      counts[event.type] = (counts[event.type] || 0) + 1;
    }
    return counts;
  }
}

// 创建全局单例
AnalyticsService.instance = new AnalyticsService();
export const analyticsService = AnalyticsService.instance;
