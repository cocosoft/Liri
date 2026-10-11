// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * kairosNotificationFactories — KAIROS 通知 / PR 订阅两个**对象字面量型**工具的工厂实现（G18，2026-10-11）
 *
 * 自 `ToolFactory.ts` **纯搬迁**（只搬不改）抽出的内聚单元：这两个工具是**内联对象字面量**定义
 * （含完整 schema + execute），体量最大（合计 ~180 行）⇒ 抽出以缩小 `ToolFactory` 的"上帝对象"体量。
 *
 * `ToolFactory` 仍保留同名**薄委托方法**（`ToolManagerUtils` 以 `ToolFactory.prototype.<method>`
 * 直接引用 ⇒ 方法必须存在）；本模块只承载实现。
 */

import type { Tool } from '../types/Tool';
import { handleError } from '@modules/error';
import { isToolEnabled } from '../utils/ToolFeatureFlags';
import {
  sendNotification,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  clearNotifications,
  isPushNotificationEnabled,
} from '../PushNotificationTool/PushNotificationTool.js';
import {
  subscribeToPR,
  getSubscriptions,
  unsubscribe,
  isPRSubscriptionEnabled,
} from '../SubscribePRTool/SubscribePRTool.js';

/**
 * 创建PushNotification工具
 * @returns PushNotification工具实例
 */
export function createPushNotificationTool(): Tool | null {
  if (!isToolEnabled('ENABLE_PUSH_NOTIFICATION')) return null;
  try {
    if (!isPushNotificationEnabled()) return null;
    return {
      name: 'push_notification',
      description:
        'Send and manage push notifications. Supports sending notifications, listing, marking as read, and clearing.',
      params: [
        {
          name: 'action',
          type: 'string',
          description:
            'Action: send, list, unread, mark_read, mark_all_read, clear',
          required: true,
          enum: [
            'send',
            'list',
            'unread',
            'mark_read',
            'mark_all_read',
            'clear',
          ],
        },
        {
          name: 'title',
          type: 'string',
          description: 'Notification title (required for send)',
          required: false,
        },
        {
          name: 'body',
          type: 'string',
          description: 'Notification body (required for send)',
          required: false,
        },
        {
          name: 'url',
          type: 'string',
          description: 'Optional URL for notification',
          required: false,
        },
        {
          name: 'notificationId',
          type: 'string',
          description: 'Notification ID (required for mark_read)',
          required: false,
        },
      ],
      execute: async (input: Record<string, unknown>) => {
        const action = input.action as string;
        switch (action) {
          case 'send': {
            const n = sendNotification(
              input.title as string,
              input.body as string,
              input.url as string | undefined
            );
            return { success: true, output: JSON.stringify(n) };
          }
          case 'list': {
            const list = getNotifications();
            return { success: true, output: JSON.stringify(list) };
          }
          case 'unread': {
            const count = getUnreadCount();
            return {
              success: true,
              output: JSON.stringify({ unread: count }),
            };
          }
          case 'mark_read': {
            const ok = markAsRead(input.notificationId as string);
            return {
              success: ok,
              output: ok ? 'Marked as read' : 'Not found',
            };
          }
          case 'mark_all_read': {
            markAllAsRead();
            return { success: true, output: 'All marked as read' };
          }
          case 'clear': {
            clearNotifications();
            return { success: true, output: 'Notifications cleared' };
          }
          default:
            return { success: false, error: `Unknown action: ${action}` };
        }
      },
      isEnabled: () => true,
    } as unknown as Tool;
  } catch (error) {
    void handleError(error, {
      module: 'tools:factory',
      action: 'create_push_notification_tool',
    });
    return null;
  }
}

/**
 * 创建SubscribePR工具
 * @returns SubscribePR工具实例
 */
export function createSubscribePRTool(): Tool | null {
  if (!isToolEnabled('ENABLE_SUBSCRIBE_PR')) return null;
  try {
    if (!isPRSubscriptionEnabled()) return null;
    return {
      name: 'subscribe_pr',
      description:
        'Subscribe to pull request events (opened, closed, merged, comment, review) for monitoring and notifications',
      params: [
        {
          name: 'action',
          type: 'string',
          description: 'Action: subscribe, list, unsubscribe',
          required: true,
          enum: ['subscribe', 'list', 'unsubscribe'],
        },
        {
          name: 'repo',
          type: 'string',
          description: 'Repository name (e.g., "owner/repo")',
          required: false,
        },
        {
          name: 'prNumber',
          type: 'number',
          description: 'PR number (optional, subscribe to specific PR)',
          required: false,
        },
        {
          name: 'events',
          type: 'array',
          description: 'Events to subscribe to',
          required: false,
        },
        {
          name: 'subscriptionId',
          type: 'string',
          description: 'Subscription ID (required for unsubscribe)',
          required: false,
        },
      ],
      execute: async (input: Record<string, unknown>) => {
        const action = input.action as string;
        if (action === 'subscribe') {
          const result = subscribeToPR(
            input.repo as string,
            input.events as string[] as any,
            input.prNumber as number | undefined
          );
          return { success: true, output: JSON.stringify(result) };
        }
        if (action === 'list') {
          const subs = getSubscriptions(input.repo as string | undefined);
          return { success: true, output: JSON.stringify(subs) };
        }
        if (action === 'unsubscribe') {
          const ok = unsubscribe(input.subscriptionId as string);
          return { success: ok, output: ok ? 'Unsubscribed' : 'Not found' };
        }
        return { success: false, error: `Unknown action: ${action}` };
      },
      isEnabled: () => true,
    } as unknown as Tool;
  } catch (error) {
    void handleError(error, {
      module: 'tools:factory',
      action: 'create_subscribe_pr_tool',
    });
    return null;
  }
}
