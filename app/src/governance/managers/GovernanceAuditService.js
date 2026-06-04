/**
 * 治理审计服务
 * 提供审计事件的持久化存储、查询和分析功能
 * 参考CC源码: cc_code/backend/services/internalLogging.ts
 */

import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import { resolveLogsDir } from '@modules/core/paths';

/**
 * 治理审计服务类
 */
class GovernanceAuditService extends EventEmitter {
  constructor() {
    super();
    this.auditPath = this.getAuditPath();
    this.events = [];
    this.maxEvents = 10000;
    this.batchSize = 100;
    this.pendingEvents = [];
    this.initialize();
  }

  /**
   * 获取单例实例
   */
  static getInstance() {
    if (!GovernanceAuditService.instance) {
      GovernanceAuditService.instance = new GovernanceAuditService();
    }
    return GovernanceAuditService.instance;
  }

  /**
   * 初始化
   */
  initialize() {
    // 确保目录存在
    this.ensureDirectories();
    // 加载审计事件
    this.events = this.loadEvents();
  }

  /**
   * 确保目录存在
   */
  ensureDirectories() {
    const auditDir = dirname(this.auditPath);
    if (!existsSync(auditDir)) {
      mkdirSync(auditDir, { recursive: true });
    }
  }

  /**
   * 获取审计文件路径
   */
  getAuditPath() {
    return join(resolveLogsDir(), 'audit', 'governance_audit.json');
  }

  /**
   * 加载审计事件
   */
  loadEvents() {
    if (existsSync(this.auditPath)) {
      try {
        const content = readFileSync(this.auditPath, 'utf-8');
        const events = JSON.parse(content);
        return Array.isArray(events) ? events : [];
      } catch (error) {
        console.error('Failed to load audit events:', error);
        return [];
      }
    }
    return [];
  }

  /**
   * 保存审计事件
   */
  saveEvents() {
    try {
      writeFileSync(
        this.auditPath,
        JSON.stringify(this.events, null, 2) + '\n'
      );
    } catch (error) {
      console.error('Failed to save audit events:', error);
    }
  }

  /**
   * 批量保存事件
   */
  flushPendingEvents() {
    if (this.pendingEvents.length > 0) {
      this.events = [...this.pendingEvents, ...this.events];

      if (this.events.length > this.maxEvents) {
        this.events = this.events.slice(0, this.maxEvents);
      }

      this.saveEvents();
      this.pendingEvents = [];
    }
  }

  /**
   * 记录审计事件
   */
  logEvent(event) {
    const auditEvent = {
      ...event,
      auditId: this.generateAuditId(),
      timestamp: event.timestamp || new Date(),
    };

    this.pendingEvents.push(auditEvent);
    this.flushPendingEvents(); // 立即保存事件

    this.emit('auditEvent', auditEvent);
    return auditEvent;
  }

  /**
   * 记录执行结果
   */
  logExecutionResult(result, userId, sessionId) {
    const event = {
      type: 'execution_completed',
      toolName: result.toolName,
      toolUseId: result.toolUseId,
      executionId: result.executionId,
      userId,
      sessionId,
      data: {
        result: result,
        success: result.success,
        error: result.error,
        executionTime: result.executionTime,
      },
    };

    return this.logEvent(event);
  }

  /**
   * 生成审计ID
   */
  generateAuditId() {
    return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 查询审计事件
   */
  queryEvents(options) {
    let filteredEvents = [...this.events];

    if (options.startDate) {
      filteredEvents = filteredEvents.filter((event) => {
        const eventTime =
          event.timestamp instanceof Date
            ? event.timestamp.getTime()
            : new Date(event.timestamp).getTime();
        return eventTime >= options.startDate;
      });
    }

    if (options.endDate) {
      filteredEvents = filteredEvents.filter((event) => {
        const eventTime =
          event.timestamp instanceof Date
            ? event.timestamp.getTime()
            : new Date(event.timestamp).getTime();
        return eventTime <= options.endDate;
      });
    }

    if (options.eventTypes && options.eventTypes.length > 0) {
      filteredEvents = filteredEvents.filter((event) =>
        options.eventTypes.includes(event.type)
      );
    }

    if (options.toolNames && options.toolNames.length > 0) {
      filteredEvents = filteredEvents.filter((event) =>
        options.toolNames.includes(event.toolName)
      );
    }

    if (options.executionIds && options.executionIds.length > 0) {
      filteredEvents = filteredEvents.filter((event) =>
        options.executionIds.includes(event.executionId)
      );
    }

    if (options.userIds && options.userIds.length > 0) {
      filteredEvents = filteredEvents.filter((event) =>
        options.userIds.includes(event.userId)
      );
    }

    if (options.sessionIds && options.sessionIds.length > 0) {
      filteredEvents = filteredEvents.filter((event) =>
        options.sessionIds.includes(event.sessionId)
      );
    }

    if (options.offset) {
      filteredEvents = filteredEvents.slice(options.offset);
    }

    if (options.limit) {
      filteredEvents = filteredEvents.slice(0, options.limit);
    }

    return filteredEvents;
  }

  /**
   * 获取审计统计
   */
  getStatistics() {
    const totalEvents = this.events.length;
    const eventsByType = {};
    const eventsByTool = {};
    const eventsByStatus = {};
    const eventsByUser = {};
    let totalExecutionTime = 0;
    let successCount = 0;
    let executionCount = 0;

    for (const event of this.events) {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
      eventsByTool[event.toolName] = (eventsByTool[event.toolName] || 0) + 1;

      if (event.userId) {
        eventsByUser[event.userId] = (eventsByUser[event.userId] || 0) + 1;
      }

      if (event.type === 'execution_completed' && event.data) {
        executionCount++;
        const success = event.data.success;
        eventsByStatus[success ? 'success' : 'failure'] =
          (eventsByStatus[success ? 'success' : 'failure'] || 0) + 1;

        if (success) {
          successCount++;
        }

        if (event.data.executionTime) {
          totalExecutionTime += event.data.executionTime;
        }
      }
    }

    return {
      totalEvents,
      eventsByType,
      eventsByTool,
      eventsByStatus,
      eventsByUser,
      averageExecutionTime:
        executionCount > 0 ? totalExecutionTime / executionCount : 0,
      successRate:
        executionCount > 0 ? (successCount / executionCount) * 100 : 0,
      recentEvents: this.events.slice(0, 10),
      executionCount,
      successCount,
    };
  }

  /**
   * 导出审计事件
   */
  exportEvents(format = 'json') {
    if (format === 'json') {
      return JSON.stringify(this.events, null, 2);
    } else if (format === 'csv') {
      const headers = [
        'auditId',
        'type',
        'toolName',
        'toolUseId',
        'executionId',
        'userId',
        'sessionId',
        'timestamp',
        'data',
      ];
      const rows = [headers.join(',')];

      for (const event of this.events) {
        const row = [
          event.auditId,
          event.type,
          event.toolName,
          event.toolUseId,
          event.executionId || '',
          event.userId || '',
          event.sessionId || '',
          event.timestamp instanceof Date
            ? event.timestamp.toISOString()
            : new Date(event.timestamp).toISOString(),
          JSON.stringify(event.data || {}),
        ];
        rows.push(row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','));
      }

      return rows.join('\n');
    } else if (format === 'summary') {
      const stats = this.getStatistics();
      return JSON.stringify(stats, null, 2);
    }
  }

  /**
   * 清理审计事件
   */
  cleanupEvents(olderThanDays) {
    const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const beforeCount = this.events.length;

    this.events = this.events.filter((event) => {
      const eventTime =
        event.timestamp instanceof Date
          ? event.timestamp.getTime()
          : new Date(event.timestamp).getTime();
      return eventTime >= cutoffTime;
    });

    this.saveEvents();
    return beforeCount - this.events.length;
  }

  /**
   * 获取所有事件
   */
  getAllEvents() {
    return [...this.events];
  }

  /**
   * 获取最近的事件
   */
  getRecentEvents(limit = 50) {
    return this.events.slice(0, limit);
  }

  /**
   * 分析审计数据
   */
  analyzeAuditData() {
    const stats = this.getStatistics();
    const insights = [];

    // 分析执行成功率
    if (stats.successRate < 70) {
      insights.push({
        type: 'warning',
        message: `执行成功率较低: ${stats.successRate.toFixed(2)}%`,
        suggestion: '检查工具执行失败的原因',
      });
    }

    // 分析平均执行时间
    if (stats.averageExecutionTime > 10000) {
      insights.push({
        type: 'warning',
        message: `平均执行时间较长: ${(stats.averageExecutionTime / 1000).toFixed(2)}秒`,
        suggestion: '优化工具执行性能',
      });
    }

    // 分析事件分布
    const mostFrequentTool = Object.entries(stats.eventsByTool).sort(
      (a, b) => b[1] - a[1]
    )[0];
    if (mostFrequentTool) {
      insights.push({
        type: 'info',
        message: `最常用的工具: ${mostFrequentTool[0]} (${mostFrequentTool[1]}次)`,
      });
    }

    return {
      stats,
      insights,
    };
  }

  /**
   * 重置服务
   */
  reset() {
    this.events = [];
    this.pendingEvents = [];
    this.saveEvents();
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
GovernanceAuditService.instance = new GovernanceAuditService();

export { GovernanceAuditService };
export const governanceAuditService = GovernanceAuditService.getInstance();
