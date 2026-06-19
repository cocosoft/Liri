/**
 * UiEventBus — UI 事件总线帮助类
 *
 * 提供类型安全的 UI 事件发布/订阅 API。
 * app 层模块通过此帮助类发布 UI 更新事件，
 * ui 层通过它订阅并渲染。
 *
 * 消除 app → ui 的直接静态依赖，改为事件驱动通信。
 *
 * 使用示例（app 层）：
 *   import { uiEventBus } from '../core/events/UiEventBus';
 *   uiEventBus.publishToolOutput('bash', 'Bash', 'Hello', 'stdout');
 *
 * 使用示例（ui 层）：
 *   import { uiEventBus } from '../core/events/UiEventBus';
 *   uiEventBus.onToolOutput((event) => renderOutput(event));
 */

import { globalEventBus } from './EventBus';
import {
  type UiToolOutputEvent,
  type UiToolStatusEvent,
  type UiCompanionEvent,
  type UiNotificationEvent,
  type UiCommandOutputEvent,
  type UiStatusMessageEvent,
  type UiEventListener,
  type UiEventSubscription,
  UiEvents,
} from './UiEvents';

/**
 * UI 事件总线
 *
 * 封装 globalEventBus 的类型安全包装，提供命名化的发布/订阅方法。
 * 可在 app 层和 ui 层之间跨层使用（事件总线本身位于 core 层）。
 */
export class UiEventBus {
  // ==================== 发布端（app 层使用） ====================

  /** 发布工具输出事件 */
  publishToolOutput(
    toolId: string,
    toolName: string,
    text: string,
    type: UiToolOutputEvent['type']
  ): void {
    globalEventBus.publish<UiToolOutputEvent>(UiEvents.TOOL_OUTPUT, {
      toolId,
      toolName,
      text,
      type,
      timestamp: Date.now(),
    });
  }

  /** 发布工具状态变更事件 */
  publishToolStatus(
    toolId: string,
    toolName: string,
    status: UiToolStatusEvent['status'],
    error?: string
  ): void {
    globalEventBus.publish<UiToolStatusEvent>(UiEvents.TOOL_STATUS, {
      toolId,
      toolName,
      status,
      error,
      timestamp: Date.now(),
    });
  }

  /** 发布 Companion 精灵更新事件 */
  publishCompanionUpdate(
    action: UiCompanionEvent['action'],
    sprite?: string,
    message?: string,
    duration?: number
  ): void {
    globalEventBus.publish<UiCompanionEvent>(UiEvents.COMPANION_UPDATE, {
      action,
      sprite,
      message,
      duration,
    });
  }

  /** 发布 UI 通知事件 */
  publishNotification(
    title: string,
    message: string,
    type: UiNotificationEvent['type'],
    duration?: number
  ): void {
    globalEventBus.publish<UiNotificationEvent>(UiEvents.NOTIFICATION, {
      title,
      message,
      type,
      duration,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
  }

  /** 发布命令输出事件 */
  publishCommandOutput(
    command: string,
    line: string,
    type: UiCommandOutputEvent['type']
  ): void {
    globalEventBus.publish<UiCommandOutputEvent>(UiEvents.COMMAND_OUTPUT, {
      command,
      line,
      type,
      timestamp: Date.now(),
    });
  }

  /** 发布通用状态消息 */
  publishStatusMessage(
    message: string,
    type: UiStatusMessageEvent['type'],
    progress?: number,
    duration?: number
  ): void {
    globalEventBus.publish<UiStatusMessageEvent>(UiEvents.STATUS_MESSAGE, {
      message,
      type,
      progress,
      duration,
    });
  }

  // ==================== 订阅端（ui 层使用） ====================

  /** 订阅工具输出事件 */
  onToolOutput(
    listener: UiEventListener<UiToolOutputEvent>
  ): UiEventSubscription {
    return globalEventBus.subscribe(UiEvents.TOOL_OUTPUT, listener);
  }

  /** 订阅工具状态变更事件 */
  onToolStatus(
    listener: UiEventListener<UiToolStatusEvent>
  ): UiEventSubscription {
    return globalEventBus.subscribe(UiEvents.TOOL_STATUS, listener);
  }

  /** 订阅 Companion 更新事件 */
  onCompanionUpdate(
    listener: UiEventListener<UiCompanionEvent>
  ): UiEventSubscription {
    return globalEventBus.subscribe(UiEvents.COMPANION_UPDATE, listener);
  }

  /** 订阅 UI 通知事件 */
  onNotification(
    listener: UiEventListener<UiNotificationEvent>
  ): UiEventSubscription {
    return globalEventBus.subscribe(UiEvents.NOTIFICATION, listener);
  }

  /** 订阅命令输出事件 */
  onCommandOutput(
    listener: UiEventListener<UiCommandOutputEvent>
  ): UiEventSubscription {
    return globalEventBus.subscribe(UiEvents.COMMAND_OUTPUT, listener);
  }

  /** 订阅通用状态消息 */
  onStatusMessage(
    listener: UiEventListener<UiStatusMessageEvent>
  ): UiEventSubscription {
    return globalEventBus.subscribe(UiEvents.STATUS_MESSAGE, listener);
  }
}

/** 全局 UI 事件总线单例 */
export const uiEventBus = new UiEventBus();
