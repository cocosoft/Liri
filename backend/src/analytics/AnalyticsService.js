/**
 * 分析服务
 * 实现事件追踪、会话分析和性能监控
 * 参考CC源码: cc_code/backend/utils/telemetry
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

/**
 * 分析服务类
 */
class AnalyticsService extends EventEmitter {
  constructor() {
    super();
    this.events = [];
    this.sessions = new Map();
    this.eventSequence = 0;
    this.maxEvents = 10000;
    this.maxSessions = 1000;
    this.sessionTimeout = 30 * 60 * 1000; // 30分钟
  }

  /**
   * 获取单例实例
   */
  static getInstance() {
    if (!AnalyticsService.instance) {
      AnalyticsService.instance = new AnalyticsService();
    }
    return AnalyticsService.instance;
  }

  /**
   * 记录事件
   * @param type 事件类型
   * @param name 事件名称
   * @param metadata 事件元数据
   * @returns 事件ID
   */
  trackEvent(type, name, metadata = {}) {
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

    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    this.emit('eventTracked', event);

    return eventId;
  }

  /**
   * 开始会话
   * @param userId 用户ID
   * @returns 会话ID
   */
  startSession(userId) {
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

    if (this.sessions.size > this.maxSessions) {
      this.cleanupInactiveSessions();
    }

    this.emit('sessionStarted', session);

    return sessionId;
  }

  /**
   * 结束会话
   * @param sessionId 会话ID
   */
  endSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.lastActivity = Date.now();
    session.totalDuration = session.lastActivity - session.startTime;

    this.sessions.delete(sessionId);
    this.emit('sessionEnded', session);
  }

  /**
   * 更新会话活动
   * @param sessionId 会话ID
   * @param operationType 操作类型
   * @param duration 操作持续时间
   */
  updateSessionActivity(sessionId, operationType, duration) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.lastActivity = Date.now();
    session.interactionCount++;
    session.totalDuration = session.lastActivity - session.startTime;

    let operation = session.operations.find((op) => op.type === operationType);
    if (!operation) {
      operation = { type: operationType, count: 0, totalDuration: 0 };
      session.operations.push(operation);
    }

    operation.count++;
    operation.totalDuration += duration;

    this.emit('sessionUpdated', session);
  }

  /**
   * 获取会话信息
   * @param sessionId 会话ID
   * @returns 会话信息
   */
  getSession(sessionId) {
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
  getEvents(options = {}) {
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

    result.sort((a, b) => b.timestamp - a.timestamp);

    if (options.limit) {
      result = result.slice(0, options.limit);
    }

    return result;
  }

  /**
   * 清理不活跃的会话
   */
  cleanupInactiveSessions() {
    const now = Date.now();
    let deletedCount = 0;

    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity > this.sessionTimeout) {
        this.sessions.delete(sessionId);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * 获取统计信息
   * @returns 统计信息
   */
  getStats() {
    const eventCounts = {
      user_interaction: 0,
      llm_request: 0,
      tool_call: 0,
      error: 0,
      system: 0,
      performance: 0,
    };

    for (const event of this.events) {
      eventCounts[event.type]++;
    }

    const sessions = this.getAllSessions();
    const totalSessionDuration = sessions.reduce(
      (sum, session) => sum + (session.lastActivity - session.startTime),
      0
    );
    const averageSessionDuration =
      sessions.length > 0 ? totalSessionDuration / sessions.length : 0;

    return {
      totalEvents: this.events.length,
      totalSessions: sessions.length,
      activeSessions: sessions.length,
      eventCounts,
      averageSessionDuration,
    };
  }

  /**
   * 导出数据
   * @param format 导出格式
   * @returns 导出的数据
   */
  exportData(format = 'json') {
    const data = {
      events: this.events,
      sessions: this.getAllSessions(),
      stats: this.getStats(),
    };

    if (format === 'json') {
      return JSON.stringify(data, null, 2);
    }

    return data;
  }

  /**
   * 清除所有数据
   */
  clearData() {
    this.events = [];
    this.sessions.clear();
    this.eventSequence = 0;
    this.emit('dataCleared');
  }

  /**
   * 重置服务
   */
  reset() {
    this.clearData();
    this.removeAllListeners();
  }
}

// 初始化单例
AnalyticsService.instance = new AnalyticsService();

/**
 * 导出单例
 */
export { AnalyticsService };
export const analyticsService = AnalyticsService.getInstance();
