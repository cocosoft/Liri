/**
 * 通道权限管理
 * 负责处理通道权限相关的功能，包括资源/工具访问控制
 *
 * 基于CC源码 cc_code/backend/services/mcp/channelPermissions.ts 实现
 */

import { logger } from '@modules/utils/log';

export type PermissionBehavior = 'always_allow' | 'always_deny' | 'ask_each_time';

export interface ResourcePermission {
  resourceUri: string;
  behavior: PermissionBehavior;
}

export interface ToolPermission {
  toolName: string;
  behavior: PermissionBehavior;
}

export interface ChannelPermissionConfig {
  serverName: string;
  defaultBehavior: PermissionBehavior;
  resourcePermissions: ResourcePermission[];
  toolPermissions: ToolPermission[];
}

/**
 * 通道权限回调
 */
export interface ChannelPermissionCallbacks {
  resolve: (requestId: string, behavior: string, serverName: string) => boolean;
  getPendingCount: () => number;
}

const permissionConfigs = new Map<string, ChannelPermissionConfig>();

/**
 * 创建通道权限回调
 */
export function createChannelPermissionCallbacks(): ChannelPermissionCallbacks {
  const pendingRequests = new Map<string, {
    resolve: (behavior: string) => void;
    serverName: string;
  }>();

  return {
    resolve: (requestId: string, behavior: string, serverName: string): boolean => {
      const request = pendingRequests.get(requestId);
      if (request) {
        pendingRequests.delete(requestId);
        request.resolve(behavior);
        logger.info(`Resolved channel permission request ${requestId} with behavior ${behavior}`);
        return true;
      }
      logger.warn(`No pending channel permission request found for ${requestId}`);
      return false;
    },

    getPendingCount: (): number => {
      return pendingRequests.size;
    },
  };
}

export function isChannelPermissionRelayEnabled(): boolean {
  return true;
}

export async function sendChannelPermissionRequest(
  serverName: string,
  content: string,
): Promise<string> {
  return 'approved';
}

export function setChannelPermissionConfig(config: ChannelPermissionConfig): void {
  permissionConfigs.set(config.serverName, config);
  logger.info(`Set channel permission config for server: ${config.serverName}`);
}

export function getChannelPermissionConfig(serverName: string): ChannelPermissionConfig | undefined {
  return permissionConfigs.get(serverName);
}

export function removeChannelPermissionConfig(serverName: string): void {
  permissionConfigs.delete(serverName);
  logger.info(`Removed channel permission config for server: ${serverName}`);
}

export function checkResourcePermission(
  serverName: string,
  resourceUri: string,
): PermissionBehavior {
  const config = permissionConfigs.get(serverName);
  if (!config) return 'ask_each_time';

  const resourcePerm = config.resourcePermissions.find(
    r => resourceUri.startsWith(r.resourceUri),
  );
  if (resourcePerm) return resourcePerm.behavior;

  return config.defaultBehavior;
}

export function checkToolPermission(
  serverName: string,
  toolName: string,
): PermissionBehavior {
  const config = permissionConfigs.get(serverName);
  if (!config) return 'ask_each_time';

  const toolPerm = config.toolPermissions.find(
    t => t.toolName === toolName,
  );
  if (toolPerm) return toolPerm.behavior;

  return config.defaultBehavior;
}

export function isResourceAccessAllowed(serverName: string, resourceUri: string): boolean {
  const behavior = checkResourcePermission(serverName, resourceUri);
  return behavior !== 'always_deny';
}

export function isToolAccessAllowed(serverName: string, toolName: string): boolean {
  const behavior = checkToolPermission(serverName, toolName);
  return behavior !== 'always_deny';
}

export const channelPermissions = {
  setChannelPermissionConfig,
  getChannelPermissionConfig,
  checkResourcePermission,
  checkToolPermission,
  isResourceAccessAllowed,
  isToolAccessAllowed,
  createChannelPermissionCallbacks,
  isChannelPermissionRelayEnabled,
  sendChannelPermissionRequest,
  removeChannelPermissionConfig,
};
