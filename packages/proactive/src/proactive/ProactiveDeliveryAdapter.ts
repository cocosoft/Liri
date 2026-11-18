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
 * G-10 P4（2026-10-19）：主动消息 → 通道投递适配器。
 *
 * - 复用 `DeliveryRouter`（per-channel 串行化 / 格式降级 / OTel），不另造通道；
 * - **默认关闭**（`enabled=false`）：只有显式开启后才会真正调用通道；
 * - 只处理 `target.mode='channel'` 且带 `channelId + conversationId` 的载荷；
 * - 投递失败**抛错**（交给 P2 队列退避/终止），不静默吞掉；
 * - 不触碰 `SUSPENDED` 投影、不恢复挂起会话（P5 不变量）。
 */
import { getDeliveryRouter } from '@modules/channels';
import type { DeliveryRouter } from '@modules/channels';
import type { ChannelId } from '@modules/channels/types';
import type { ProactiveMessagePayload } from './types';

/** 适配器需要的最小路由端口（测试可注入） */
export interface ProactiveChannelPort {
  isPlatformAvailable(platform: ChannelId): boolean;
  route(
    platform: ChannelId,
    conversationId: string,
    content: { format: 'text'; content: string }
  ): Promise<{ success: boolean; error?: string }>;
}

export interface ProactiveDeliveryAdapterOptions {
  /** 是否真正投递（默认 false；按通道灰度时由调用方传入） */
  enabled?: boolean;
  /** 路由端口（缺省使用全局 DeliveryRouter） */
  port?: ProactiveChannelPort;
}

/**
 * 创建 P2 队列可消费的 `deliver` 回调。
 *
 * @throws 未启用 / 目标缺失 / 通道不可用 / 投递失败 —— 由队列按失败重试或终止。
 */
export function createProactiveDeliveryAdapter(
  options: ProactiveDeliveryAdapterOptions = {}
): (payload: ProactiveMessagePayload) => Promise<void> {
  const enabled = options.enabled ?? false;
  const port: ProactiveChannelPort = options.port ?? getDeliveryRouter();

  return async (payload) => {
    if (!enabled) {
      throw new Error('proactive_channel_routing_disabled');
    }
    const target = payload.target;
    if (
      !target ||
      target.mode !== 'channel' ||
      !target.channelId ||
      !target.conversationId
    ) {
      throw new Error('proactive_target_missing_channel');
    }
    const platform = target.channelId as ChannelId;
    if (!port.isPlatformAvailable(platform)) {
      throw new Error(`proactive_channel_unavailable:${platform}`);
    }
    const result = await port.route(platform, target.conversationId, {
      format: 'text',
      content: `${payload.title}\n\n${payload.body}`,
    });
    if (!result.success) {
      throw new Error(result.error || 'proactive_delivery_failed');
    }
  };
}

/** 类型再导出：便于调用方注入真实 `DeliveryRouter` */
export type { DeliveryRouter };
