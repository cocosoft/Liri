/**
 * 负责插件的事件发布、订阅、过滤和路由
 */

import { EventEmitter } from 'events';
import { PluginEvent, PluginEventType } from '../types/PluginTypes';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'plugins:core:pluginEventSystem',
  level: LogLevel.INFO,
});

/**
 * 事件处理器
 */
export interface EventHandler {
  /** 处理器ID */
  id: string;

  /** 事件类型 */
  eventType: PluginEventType | string;

  /** 处理器函数 */
  handler: (event: PluginEvent) => Promise<void> | void;

  /** 优先级 */
  priority?: number;

  /** 是否一次性 */
  once?: boolean;

  /** 插件ID */
  pluginId?: string;
}

/**
 * 事件过滤器
 */
export interface EventFilter {
  /** 过滤器ID */
  id: string;

  /** 事件类型 */
  eventType: PluginEventType | string;

  /** 过滤器函数 */
  filter: (event: PluginEvent) => boolean;

  /** 插件ID */
  pluginId?: string;
}

/**
 * 事件路由规则
 */
export interface EventRoutingRule {
  /** 规则ID */
  id: string;

  /** 源事件类型 */
  sourceEventType: PluginEventType | string;

  /** 目标事件类型 */
  targetEventType: PluginEventType | string;

  /** 转换函数 */
  transform?: (event: PluginEvent) => PluginEvent;

  /** 条件函数 */
  condition?: (event: PluginEvent) => boolean;
}

/**
 * 插件事件系统
 */
export class PluginEventSystem extends EventEmitter {
  private handlers: Map<string, EventHandler[]> = new Map();
  private filters: Map<string, EventFilter[]> = new Map();
  private routingRules: EventRoutingRule[] = [];
  private eventHistory: PluginEvent[] = [];
  private maxHistorySize = 1000;

  /**
   * 注册事件处理器
   */
  registerHandler(handler: EventHandler): void {
    const eventType = handler.eventType;

    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }

    const handlers = this.handlers.get(eventType)!;

    // 检查是否已存在
    const existingIndex = handlers.findIndex((h) => h.id === handler.id);

    if (existingIndex !== -1) {
      handlers.splice(existingIndex, 1);
    }

    // 按优先级排序
    handlers.push(handler);
    handlers.sort((a, b) => (a.priority || 0) - (b.priority || 0));

    logger.info(`✅ Event handler registered: ${handler.id} for ${eventType}`);
  }

  /**
   * 注销事件处理器
   */
  unregisterHandler(handlerId: string, eventType?: string): boolean {
    if (eventType) {
      // 注销特定事件类型的处理器
      const handlers = this.handlers.get(eventType);

      if (!handlers) {
        return false;
      }

      const index = handlers.findIndex((h) => h.id === handlerId);

      if (index === -1) {
        return false;
      }

      handlers.splice(index, 1);

      logger.info(
        `✅ Event handler unregistered: ${handlerId} from ${eventType}`
      );

      return true;
    } else {
      // 注销所有事件类型的处理器
      let found = false;

      for (const [type, handlers] of this.handlers.entries()) {
        const index = handlers.findIndex((h) => h.id === handlerId);

        if (index !== -1) {
          handlers.splice(index, 1);
          found = true;
          logger.info(
            `✅ Event handler unregistered: ${handlerId} from ${type}`
          );
        }
      }

      return found;
    }
  }

  /**
   * 注册事件过滤器
   */
  registerFilter(filter: EventFilter): void {
    const eventType = filter.eventType;

    if (!this.filters.has(eventType)) {
      this.filters.set(eventType, []);
    }

    const filters = this.filters.get(eventType)!;

    // 检查是否已存在
    const existingIndex = filters.findIndex((f) => f.id === filter.id);

    if (existingIndex !== -1) {
      filters.splice(existingIndex, 1);
    }

    filters.push(filter);

    logger.info(`✅ Event filter registered: ${filter.id} for ${eventType}`);
  }

  /**
   * 注销事件过滤器
   */
  unregisterFilter(filterId: string, eventType?: string): boolean {
    if (eventType) {
      // 注销特定事件类型的过滤器
      const filters = this.filters.get(eventType);

      if (!filters) {
        return false;
      }

      const index = filters.findIndex((f) => f.id === filterId);

      if (index === -1) {
        return false;
      }

      filters.splice(index, 1);

      logger.info(
        `✅ Event filter unregistered: ${filterId} from ${eventType}`
      );

      return true;
    } else {
      // 注销所有事件类型的过滤器
      let found = false;

      for (const [type, filters] of this.filters.entries()) {
        const index = filters.findIndex((f) => f.id === filterId);

        if (index !== -1) {
          filters.splice(index, 1);
          found = true;
          logger.info(`✅ Event filter unregistered: ${filterId} from ${type}`);
        }
      }

      return found;
    }
  }

  /**
   * 添加事件路由规则
   */
  addRoutingRule(rule: EventRoutingRule): void {
    // 检查是否已存在
    const existingIndex = this.routingRules.findIndex((r) => r.id === rule.id);

    if (existingIndex !== -1) {
      this.routingRules.splice(existingIndex, 1);
    }

    this.routingRules.push(rule);

    logger.info(`✅ Event routing rule added: ${rule.id}`);
  }

  /**
   * 移除事件路由规则
   */
  removeRoutingRule(ruleId: string): boolean {
    const index = this.routingRules.findIndex((r) => r.id === ruleId);

    if (index === -1) {
      return false;
    }

    this.routingRules.splice(index, 1);

    logger.info(`✅ Event routing rule removed: ${ruleId}`);

    return true;
  }

  /**
   * 发布事件
   */
  async publishEvent(event: PluginEvent): Promise<void> {
    // 添加到历史记录
    this.addToHistory(event);

    // 应用事件路由
    const routedEvents = this.applyRoutingRules(event);

    // 处理所有事件（包括路由后的事件）
    const allEvents = [event, ...routedEvents];

    for (const evt of allEvents) {
      await this.processEvent(evt);
    }
  }

  /**
   * 应用事件路由规则
   */
  private applyRoutingRules(event: PluginEvent): PluginEvent[] {
    const routedEvents: PluginEvent[] = [];

    for (const rule of this.routingRules) {
      if (rule.sourceEventType !== event.type) {
        continue;
      }

      if (rule.condition && !rule.condition(event)) {
        continue;
      }

      const routedEvent = rule.transform
        ? rule.transform(event)
        : {
            ...event,
            type: rule.targetEventType as PluginEventType,
          };

      routedEvents.push(routedEvent);
    }

    return routedEvents;
  }

  /**
   * 处理事件
   */
  private async processEvent(event: PluginEvent): Promise<void> {
    const eventType = event.type;

    // 获取事件处理器
    const handlers = this.handlers.get(eventType) || [];

    if (handlers.length === 0) {
      return;
    }

    // 应用事件过滤器
    const filters = this.filters.get(eventType) || [];

    for (const filter of filters) {
      if (!filter.filter(event)) {
        logger.debug(`Event filtered: ${eventType} by ${filter.id}`);
        return;
      }
    }

    // 执行事件处理器
    for (const handler of handlers) {
      try {
        await handler.handler(event);

        // 如果是一次性处理器，注销
        if (handler.once) {
          this.unregisterHandler(handler.id, eventType);
        }
      } catch (error) {
        logger.error(`Event handler ${handler.id} failed:`, { error });

        // 发射错误事件
        this.emit('handlerError', {
          handlerId: handler.id,
          event,
          error,
        });
      }
    }
  }

  /**
   * 添加到历史记录
   */
  private addToHistory(event: PluginEvent): void {
    this.eventHistory.push(event);

    // 限制历史记录大小
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * 获取事件历史
   */
  getEventHistory(filter?: {
    eventType?: string;
    pluginId?: string;
    limit?: number;
  }): PluginEvent[] {
    let filteredHistory = this.eventHistory;

    if (filter?.eventType) {
      filteredHistory = filteredHistory.filter(
        (e) => e.type === filter.eventType
      );
    }

    if (filter?.pluginId) {
      filteredHistory = filteredHistory.filter(
        (e) => e.pluginId === filter.pluginId
      );
    }

    if (filter?.limit) {
      filteredHistory = filteredHistory.slice(-filter.limit);
    }

    return filteredHistory;
  }

  /**
   * 获取事件统计
   */
  getEventStats(): {
    totalEvents: number;
    eventTypes: Record<string, number>;
    plugins: Record<string, number>;
    recentEvents: number;
  } {
    const eventTypes: Record<string, number> = {};
    const plugins: Record<string, number> = {};

    for (const event of this.eventHistory) {
      eventTypes[event.type] = (eventTypes[event.type] || 0) + 1;

      if (event.pluginId) {
        plugins[event.pluginId] = (plugins[event.pluginId] || 0) + 1;
      }
    }

    const recentEvents = this.eventHistory.filter(
      (e) => Date.now() - e.timestamp.getTime() < 24 * 60 * 60 * 1000
    ).length;

    return {
      totalEvents: this.eventHistory.length,
      eventTypes,
      plugins,
      recentEvents,
    };
  }

  /**
   * 获取事件处理器统计
   */
  getHandlerStats(): {
    totalHandlers: number;
    handlersByType: Record<string, number>;
    plugins: Record<string, number>;
  } {
    const handlersByType: Record<string, number> = {};
    const plugins: Record<string, number> = {};
    let totalHandlers = 0;

    for (const [eventType, handlers] of this.handlers.entries()) {
      handlersByType[eventType] = handlers.length;
      totalHandlers += handlers.length;

      for (const handler of handlers) {
        if (handler.pluginId) {
          plugins[handler.pluginId] = (plugins[handler.pluginId] || 0) + 1;
        }
      }
    }

    return {
      totalHandlers,
      handlersByType,
      plugins,
    };
  }

  /**
   * 清理事件系统
   */
  clear(): void {
    this.handlers.clear();
    this.filters.clear();
    this.routingRules = [];
    this.eventHistory = [];

    logger.info('✅ Plugin event system cleared');
  }

  /**
   * 销毁事件系统
   */
  destroy(): void {
    this.clear();
    this.removeAllListeners();

    logger.info('✅ Plugin event system destroyed');
  }
}

export default PluginEventSystem;
