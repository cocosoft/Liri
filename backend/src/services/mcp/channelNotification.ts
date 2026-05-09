//
/**
 * 通道通知处理
 * 负责处理Claude AI的通道消息通知
 */

import { logger } from '@modules/utils/log';
import type { ConnectedMCPServer } from './types';

// 通道权限方法名
export const CHANNEL_PERMISSION_METHOD = 'notifications/claude/channel/permission';

/**
 * 包装通道消息
 */
export function wrapChannelMessage(serverName: string, content: string, meta?: any): string {
  return `[Channel: ${serverName}] ${content}`;
}

/**
 * 查找通道条目
 */
export function findChannelEntry(serverName: string, allowedChannels: any[]): any {
  // 实现通道条目查找逻辑
  return allowedChannels.find(entry => entry.name === serverName);
}

/**
 * 通道服务器 gate
 */
export function gateChannelServer(
  serverName: string,
  capabilities: any,
  pluginSource?: string
): { action: 'register' | 'skip'; kind: string; reason: string } {
  // 检查服务器能力
  if (!capabilities?.experimental?.['claude/channel']) {
    return {
      action: 'skip',
      kind: 'capability',
      reason: 'Server does not support channels'
    };
  }

  // 其他检查逻辑
  return {
    action: 'register',
    kind: 'allowed',
    reason: 'Server is allowed'
  };
}

/**
 * 注册通道通知处理器
 */
export function registerChannelNotificationHandler(
  server: ConnectedMCPServer,
  onMessage: (content: string, meta?: any) => void
): void {
  try {
    // 注册通道消息通知处理器
    server.client.setNotificationHandler(
      'notifications/claude/channel' as any,
      async notification => {
        const { content, meta } = (notification as any).params;
        logger.info(`Received channel message from ${server.name}: ${(content as string).slice(0, 80)}`);
        onMessage(content, meta);
      }
    );

    // 注册通道权限通知处理器
    if (server.capabilities?.experimental?.['claude/channel/permission']) {
      server.client.setNotificationHandler(
        CHANNEL_PERMISSION_METHOD as any,
        async notification => {
          const { request_id, behavior } = (notification as any).params;
          logger.info(`Received channel permission notification: ${request_id} → ${behavior}`);
          // 处理权限通知
        }
      );
    }

    logger.info(`Registered channel notification handlers for server ${server.name}`);
  } catch (error) {
    logger.error(`Failed to register channel notification handlers:`, error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * 移除通道通知处理器
 */
export function removeChannelNotificationHandler(server: ConnectedMCPServer): void {
  try {
    server.client.removeNotificationHandler('notifications/claude/channel');
    server.client.removeNotificationHandler(CHANNEL_PERMISSION_METHOD);
    logger.info(`Removed channel notification handlers for server ${server.name}`);
  } catch (error) {
    logger.error(`Failed to remove channel notification handlers:`, error instanceof Error ? error : new Error(String(error)));
  }
}