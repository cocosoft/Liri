//
/**
 * 数据收集器
 * 实现高级数据收集和预处理功能
 */

import type { AnalyticsEvent, SessionAnalytics } from './types.js';
import { getLogger } from '@modules/monitoring/logs/Logger';

const logger = getLogger('DataCollector');

export class DataCollector {
  private events: AnalyticsEvent[] = [];
  private eventBuffer: AnalyticsEvent[] = [];
  private bufferSize = 100;
  private flushInterval = 5000; // 5秒刷新间隔
  private flushTimer?: NodeJS.Timeout;

  constructor() {
    this.startAutoFlush();
  }

  /**
   * 收集事件数据
   */
  collectEvent(event: AnalyticsEvent): void {
    this.eventBuffer.push(event);

    // 如果缓冲区满了，立即刷新
    if (this.eventBuffer.length >= this.bufferSize) {
      this.flushBuffer();
    }
  }

  /**
   * 批量收集事件数据
   */
  collectEvents(events: AnalyticsEvent[]): void {
    events.forEach((event) => this.collectEvent(event));
  }

  /**
   * 获取收集的事件数据
   */
  getCollectedEvents(): AnalyticsEvent[] {
    // 返回主存储和缓冲区的所有事件
    return [...this.events, ...this.eventBuffer];
  }

  /**
   * 获取事件统计信息
   */
  getEventStats(): EventStats {
    const allEvents = [...this.events, ...this.eventBuffer];
    const stats: EventStats = {
      totalEvents: allEvents.length,
      eventsByType: new Map(),
      eventsBySource: new Map(),
      eventsByHour: new Map(),
      eventsByDay: new Map(),
      averageEventSize: 0,
      peakHour: { hour: 0, count: 0 },
    };

    let totalSize = 0;
    const hourlyCounts = new Map<number, number>();

    allEvents.forEach((event) => {
      // 按事件类型统计
      const typeCount = stats.eventsByType.get(event.eventName) || 0;
      stats.eventsByType.set(event.eventName, typeCount + 1);

      // 按事件源统计
      const source = (event.metadata.source as string) || 'unknown';
      const sourceCount = stats.eventsBySource.get(source) || 0;
      stats.eventsBySource.set(source, sourceCount + 1);

      // 按小时统计
      const eventDate = new Date(event.timestamp);
      const hour = eventDate.getHours();
      const hourCount = hourlyCounts.get(hour) || 0;
      hourlyCounts.set(hour, hourCount + 1);

      // 按日期统计
      const day = eventDate.toDateString();
      const dayCount = stats.eventsByDay.get(day) || 0;
      stats.eventsByDay.set(day, dayCount + 1);

      // 计算事件大小
      totalSize += JSON.stringify(event).length;
    });

    // 计算平均事件大小
    stats.averageEventSize =
      allEvents.length > 0 ? totalSize / allEvents.length : 0;

    // 找到峰值小时
    hourlyCounts.forEach((count, hour) => {
      if (count > stats.peakHour.count) {
        stats.peakHour = { hour, count };
      }
    });

    // 转换小时统计为可序列化格式
    stats.eventsByHour = new Map(Array.from(hourlyCounts.entries()));

    return stats;
  }

  /**
   * 过滤事件数据
   */
  filterEvents(
    predicate: (event: AnalyticsEvent) => boolean
  ): AnalyticsEvent[] {
    const allEvents = [...this.events, ...this.eventBuffer];
    return allEvents.filter(predicate);
  }

  /**
   * 按时间范围查询事件
   */
  getEventsByTimeRange(startTime: number, endTime: number): AnalyticsEvent[] {
    const allEvents = [...this.events, ...this.eventBuffer];
    return allEvents.filter(
      (event) => event.timestamp >= startTime && event.timestamp <= endTime
    );
  }

  /**
   * 按事件类型查询事件
   */
  getEventsByType(eventType: string): AnalyticsEvent[] {
    const allEvents = [...this.events, ...this.eventBuffer];
    return allEvents.filter((event) => event.eventName === eventType);
  }

  /**
   * 清空收集的数据
   */
  clear(): void {
    this.events = [];
    this.eventBuffer = [];
  }

  /**
   * 销毁收集器
   */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flushBuffer();
  }

  /**
   * 启动自动刷新
   */
  private startAutoFlush(): void {
    this.flushTimer = setInterval(() => {
      if (this.eventBuffer.length > 0) {
        this.flushBuffer();
      }
    }, this.flushInterval);
  }

  /**
   * 刷新缓冲区
   */
  private flushBuffer(): void {
    if (this.eventBuffer.length > 0) {
      this.events.push(...this.eventBuffer);
      const count = this.eventBuffer.length;
      this.eventBuffer = [];
      logger.info(`${count} 个事件已刷新到主存储`);
    }
  }

  /**
   * 导出数据为JSON格式
   */
  exportData(): string {
    const allEvents = [...this.events, ...this.eventBuffer];
    return JSON.stringify(
      {
        events: allEvents,
        stats: this.getEventStats(),
        exportedAt: Date.now(),
      },
      null,
      2
    );
  }

  /**
   * 导入数据
   */
  importData(data: string): void {
    try {
      const parsedData = JSON.parse(data);
      if (parsedData.events && Array.isArray(parsedData.events)) {
        // 直接将事件添加到主存储，不经过缓冲区
        this.events.push(...parsedData.events);
      }
    } catch (error) {
      logger.error('导入数据失败:', error);
    }
  }
}

/**
 * 事件统计信息
 */
export interface EventStats {
  totalEvents: number;
  eventsByType: Map<string, number>;
  eventsBySource: Map<string, number>;
  eventsByHour: Map<number, number>;
  eventsByDay: Map<string, number>;
  averageEventSize: number;
  peakHour: { hour: number; count: number };
}
