// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * G-10 P3（2026-10-19）：主动消息 → **本地通知**投递（队列 → `notifications`）。
 *
 * - 写既有 `notifications` 表（`source = 'proactive'`），P3 卡片据此渲染；
 * - `source_ref = payload.id` 作投递幂等键：重放前先查，避免崩溃重放重复；
 * - 只映射白名单动作（`dismiss` 为真实动作，其余一律「查看」），不执行任何命令；
 * - `notifications.expires_at` 是**秒**，入参 `expiresAt` 是毫秒，这里显式换算。
 */
import { MS_PER_SECOND } from '@modules/constants';
import {
  notificationPersistence,
  type NotificationAction,
  type NotificationCreateInput,
  type NotificationPriority,
} from '@modules/runtime/NotificationPersistence.js';
import type {
  ProactiveAction,
  ProactiveMessagePayload,
  ProactivePriority,
} from './types';

/** 本地推送在 `notifications.source` 上的稳定标识（前端 P3 卡片按此分支） */
export const PROACTIVE_NOTIFICATION_SOURCE = 'proactive';

/** 优先级映射：主动消息四级 → 通知三级（`high` 归 normal，避免误渲染为 critical） */
const NOTIFICATION_PRIORITY: Readonly<
  Record<ProactivePriority, NotificationPriority>
> = {
  critical: 'urgent',
  high: 'normal',
  normal: 'normal',
  low: 'low',
};

/** 动作映射：只保留 `dismiss` 语义，其余统一「查看」（P3 卡片不执行命令） */
function toNotificationActions(
  actions?: ProactiveAction[]
): NotificationAction[] | undefined {
  if (!actions || actions.length === 0) return undefined;
  return actions.map((action) => ({
    label: action.label,
    action: action.kind === 'dismiss' ? 'dismiss' : 'view',
  }));
}

/** 最小本地通知端口（测试可注入） */
export interface ProactiveLocalPort {
  findBySourceRef(source: string, sourceRef: string): Promise<unknown | null>;
  create(input: NotificationCreateInput): Promise<unknown>;
}

export interface ProactiveLocalDeliveryOptions {
  /** 缺省使用全局 `notificationPersistence()` */
  port?: ProactiveLocalPort;
}

/**
 * 创建 P2 队列可消费的本地投递回调。
 *
 * @throws 通道目标被误投到本地 / 写库失败 —— 由队列按失败重试或终止。
 */
export function createProactiveLocalDelivery(
  options: ProactiveLocalDeliveryOptions = {}
): (payload: ProactiveMessagePayload) => Promise<void> {
  const port: ProactiveLocalPort = options.port ?? notificationPersistence();

  return async (payload) => {
    if (payload.target?.mode === 'channel') {
      throw new Error('proactive_local_delivery_channel_target');
    }
    const exists = await port.findBySourceRef(
      PROACTIVE_NOTIFICATION_SOURCE,
      payload.id
    );
    if (exists) return;
    await port.create({
      category: 'notice',
      priority: NOTIFICATION_PRIORITY[payload.priority],
      title: payload.title,
      content: payload.body,
      source: PROACTIVE_NOTIFICATION_SOURCE,
      source_ref: payload.id,
      actions: toNotificationActions(payload.actions),
      link_to: payload.target?.sessionId
        ? { type: 'session', id: payload.target.sessionId }
        : null,
      expires_at: Math.floor(payload.expiresAt / MS_PER_SECOND),
    });
  };
}
