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
 * ChannelBridgeAdapter — 遗留通道桥接适配器
 *
 * 将 core/gateway/ ChannelManager 注册的遗留通道桥接到 channels/ 体系的
 * ChannelRegistry 中。使新统一路由（routeChannelMessage）非侵入式地兼容旧通道。
 *
 * 桥接策略：
 * - 适配 ChannelRegistration → ChannelInterface / IChannelPlugin
 * - 入站消息委托给 routeChannelMessage 统一管线
 * - 出站使用 adaptPluginToChannelInterface 的 outbound.sendText
 *
 * 生命周期：
 * - 创建时机：应用启动阶段，ChannelManager 初始化完成后
 * - 销毁时机：ChannelManager 完全退役后移除
 */

import { getLogger } from '@modules/monitoring';
import { channelRegistry } from '../registry/ChannelRegistry';
import { routeChannelMessage } from '../routing/messageRouter';
import { handleError } from '../../error/handleError';
import type { MessageContext, ChannelId } from '../types/IChannel';
import type { ChannelInterface } from '../registry/ChannelRegistry';

const logger = getLogger('channels:bridge:adapter');

/** 遗留通道信道的简化接口（来自 ChannelManager 的 ChannelRegistration） */
export interface LegacyChannel {
  /** 通道唯一名称 */
  name: string;
  /** 通道类型 */
  type: string;
  /** 是否已连接 */
  isConnected(): boolean;
  /** 入站消息回调注册 */
  onMessage?(
    handler: (msg: {
      content: string;
      sender: string;
      metadata?: Record<string, unknown>;
    }) => void
  ): void;
  /** 发送文本消息 */
  send?(params: {
    content: string;
    sessionId: string;
    recipient: string;
    type: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  /** 获取状态 */
  getStatus?(): {
    connected: boolean;
    type: string;
    metrics?: Record<string, unknown>;
  };
}

/** 桥接选项 */
export interface BridgeOptions {
  /** CoreAPI 实例 */
  coreAPI: {
    chat(params: {
      content: string;
      sessionId: string;
      metadata?: Record<string, unknown>;
    }): Promise<{ content: string }>;
  };
  /** 桥接的通道列表 */
  channels: LegacyChannel[];
}

/**
 * 将遗留通道桥接到新 ChannelRegistry
 *
 * 为每个 LegacyChannel 创建一个 ChannelInterface 包装器，
 * 注册到 channelRegistry，并设置入站消息处理器委托给统一路由管线。
 */
export function bridgeLegacyChannels(options: BridgeOptions): void {
  const { coreAPI, channels } = options;

  if (channels.length === 0) {
    return;
  }

  let bridgeCount = 0;

  for (const legacy of channels) {
    const channelName = legacy.name;

    // 跳过已注册的通道（避免重复桥接）
    const existing = channelRegistry.get(channelName);
    if (existing) {
      logger.debug(`通道 ${channelName} 已注册，跳过桥接`);
      continue;
    }

    // 构建 ChannelInterface 包装器
    const adapter: ChannelInterface = {
      name: channelName,
      type: legacy.type,
      enabled: true,
      connected: legacy.isConnected?.() ?? false,
      get homeChannelId() {
        return undefined; // 遗留通道无 homeChannel 概念
      },
      supportsThreads: false,

      connect: async () => {
        // 遗留通道的连接由 ChannelManager 管理，适配器不做连接操作
        logger.debug(`遗留通道 ${channelName} 连接由 ChannelManager 管理`);
        return true;
      },

      disconnect: async () => {
        // 同理，断开由 ChannelManager 管理
        logger.debug(`遗留通道 ${channelName} 断开由 ChannelManager 管理`);
      },

      sendMessage: async (target: string, text: string) => {
        if (!legacy.send) {
          return false;
        }
        try {
          await legacy.send({
            content: text,
            sessionId: target,
            recipient: target,
            type: 'text',
          });
          return true;
        } catch (error) {
          await handleError(error, {
            module: 'channels:bridge',
            action: 'legacySend',
            context: { channelName },
          });
          return false;
        }
      },

      getStatus: () => {
        const connected = legacy.isConnected?.() ?? false;
        return {
          status: connected ? 'connected' : 'disconnected',
          connected,
          type: legacy.type,
        };
      },
    };

    // 注册到 channelRegistry
    channelRegistry.register(adapter);
    bridgeCount++;

    // 设置入站消息处理（如果遗留通道支持 onMessage）
    if (legacy.onMessage) {
      legacy.onMessage(async (msg) => {
        const messageContext: MessageContext = {
          messageId: `${channelName}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          channelId: channelName as ChannelId,
          senderId: msg.sender,
          senderName: msg.sender,
          content: msg.content,
          messageType: 'text',
          timestamp: Date.now(),
          isDirectMessage: true,
          conversationId: msg.sender,
          rawPayload: (msg.metadata ?? {}) as Record<string, unknown>,
        };

        try {
          await routeChannelMessage(messageContext, {
            coreAPI,
            channelName,
            enableTracing: true,
            onOutbound: async (content, target) => {
              if (legacy.send) {
                await legacy.send({
                  content,
                  sessionId: target,
                  recipient: target,
                  type: 'text',
                });
              }
            },
          });
        } catch (error) {
          await handleError(error, {
            module: 'channels:bridge',
            action: 'legacyInboundMessage',
            context: { channelName },
          });
        }
      });
    }

    logger.info(`遗留通道已桥接: ${channelName} (${legacy.type})`);
  }

  logger.info(`通道桥接完成: ${bridgeCount}/${channels.length} 个通道`);
}
