/**
 * MCP缓存管理器
 * 负责管理MCP服务器的缓存策略
 */

import { logger } from '../../utils/log';
import type { Tool } from '../../Tool';
import type { Command } from '../../commands';
import type { ServerResource } from './types';

/**
 * 缓存项
 */
interface CacheItem<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

/**
 * MCP缓存管理器
 */
export class MCPCacheManager {
  private toolCache: Map<string, CacheItem<Tool[]>> = new Map();
  private commandCache: Map<string, CacheItem<Command[]>> = new Map();
  private resourceCache: Map<string, CacheItem<ServerResource[]>> = new Map();
  private capabilitiesCache: Map<string, CacheItem<any>> = new Map();

  // 默认缓存时间（毫秒）
  private defaultTTL = 5 * 60 * 1000; // 5分钟

  /**
   * 设置工具缓存
   */
  setToolCache(serverName: string, tools: Tool[], ttl?: number): void {
    this.toolCache.set(serverName, {
      data: tools,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL
    });
    logger.debug(`Set tool cache for server ${serverName}: ${tools.length} tools`);
  }

  /**
   * 获取工具缓存
   */
  getToolCache(serverName: string): Tool[] | null {
    const cache = this.toolCache.get(serverName);
    if (!cache) {
      return null;
    }

    if (Date.now() - cache.timestamp > cache.ttl) {
      this.toolCache.delete(serverName);
      return null;
    }

    return cache.data;
  }

  /**
   * 设置命令缓存
   */
  setCommandCache(serverName: string, commands: Command[], ttl?: number): void {
    this.commandCache.set(serverName, {
      data: commands,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL
    });
    logger.debug(`Set command cache for server ${serverName}: ${commands.length} commands`);
  }

  /**
   * 获取命令缓存
   */
  getCommandCache(serverName: string): Command[] | null {
    const cache = this.commandCache.get(serverName);
    if (!cache) {
      return null;
    }

    if (Date.now() - cache.timestamp > cache.ttl) {
      this.commandCache.delete(serverName);
      return null;
    }

    return cache.data;
  }

  /**
   * 设置资源缓存
   */
  setResourceCache(serverName: string, resources: ServerResource[], ttl?: number): void {
    this.resourceCache.set(serverName, {
      data: resources,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL
    });
    logger.debug(`Set resource cache for server ${serverName}: ${resources.length} resources`);
  }

  /**
   * 获取资源缓存
   */
  getResourceCache(serverName: string): ServerResource[] | null {
    const cache = this.resourceCache.get(serverName);
    if (!cache) {
      return null;
    }

    if (Date.now() - cache.timestamp > cache.ttl) {
      this.resourceCache.delete(serverName);
      return null;
    }

    return cache.data;
  }

  /**
   * 设置能力缓存
   */
  setCapabilitiesCache(serverName: string, capabilities: any, ttl?: number): void {
    this.capabilitiesCache.set(serverName, {
      data: capabilities,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL
    });
    logger.debug(`Set capabilities cache for server ${serverName}`);
  }

  /**
   * 获取能力缓存
   */
  getCapabilitiesCache(serverName: string): any | null {
    const cache = this.capabilitiesCache.get(serverName);
    if (!cache) {
      return null;
    }

    if (Date.now() - cache.timestamp > cache.ttl) {
      this.capabilitiesCache.delete(serverName);
      return null;
    }

    return cache.data;
  }

  /**
   * 清除服务器的所有缓存
   */
  clearServerCache(serverName: string): void {
    this.toolCache.delete(serverName);
    this.commandCache.delete(serverName);
    this.resourceCache.delete(serverName);
    this.capabilitiesCache.delete(serverName);
    logger.debug(`Cleared all cache for server ${serverName}`);
  }

  /**
   * 清除所有缓存
   */
  clearAllCache(): void {
    this.toolCache.clear();
    this.commandCache.clear();
    this.resourceCache.clear();
    this.capabilitiesCache.clear();
    logger.debug('Cleared all MCP cache');
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats(): {
    toolCacheSize: number;
    commandCacheSize: number;
    resourceCacheSize: number;
    capabilitiesCacheSize: number;
  } {
    return {
      toolCacheSize: this.toolCache.size,
      commandCacheSize: this.commandCache.size,
      resourceCacheSize: this.resourceCache.size,
      capabilitiesCacheSize: this.capabilitiesCache.size
    };
  }
}

// 导出单例
export const mcpCacheManager = new MCPCacheManager();