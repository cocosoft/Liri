// @ts-nocheck
/**
 * 资源管理
 * 负责处理MCP服务器的资源功能
 */

import { logger } from '@modules/utils/log';
import type { ServerResource } from './types';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

/**
 * 资源管理器
 */
export class ResourceManager {
  private resources: Map<string, ServerResource[]> = new Map();

  /**
   * 从MCP服务器加载资源
   */
  async loadResourcesFromServer(client: Client, serverName: string): Promise<ServerResource[]> {
    try {
      const resources = await client.resources.list();
      const serverResources = resources.map(resource => ({
        ...resource,
        server: serverName
      }));

      this.resources.set(serverName, serverResources);
      logger.info(`Loaded ${serverResources.length} resources from server ${serverName}`);
      return serverResources;
    } catch (error) {
      logger.error(`Failed to load resources from server ${serverName}:`, error);
      return [];
    }
  }

  /**
   * 获取所有资源
   */
  getResources(): ServerResource[] {
    return Array.from(this.resources.values()).flat();
  }

  /**
   * 获取服务器的资源
   */
  getServerResources(serverName: string): ServerResource[] {
    return this.resources.get(serverName) || [];
  }

  /**
   * 获取单个资源
   */
  getResource(serverName: string, resourceId: string): ServerResource | undefined {
    const resources = this.resources.get(serverName);
    return resources?.find(r => r.id === resourceId);
  }

  /**
   * 移除服务器的所有资源
   */
  removeServerResources(serverName: string): void {
    this.resources.delete(serverName);
    logger.info(`Removed resources from server ${serverName}`);
  }

  /**
   * 清空所有资源
   */
  clear(): void {
    this.resources.clear();
    logger.info('Cleared all resources');
  }
}

// 导出单例
export const resourceManager = new ResourceManager();