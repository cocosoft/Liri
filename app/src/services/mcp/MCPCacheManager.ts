import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });
import type { ICache, CacheStats } from '@modules/cache/types';
import type { Command } from '@modules/commands';
import type { ServerResource, SerializedTool } from './types';

interface MCPCacheItem<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export class MCPCacheManager implements ICache<string, unknown> {
  private toolCache: Map<string, MCPCacheItem<SerializedTool[]>> = new Map();
  private commandCache: Map<string, MCPCacheItem<Command[]>> = new Map();
  private resourceCache: Map<string, MCPCacheItem<ServerResource[]>> =
    new Map();
  private capabilitiesCache: Map<string, MCPCacheItem<unknown>> = new Map();

  private defaultTTL = 5 * 60 * 1000;

  get(key: string): unknown | null {
    const [type, ...nameParts] = key.split(':');
    const name = nameParts.join(':');

    switch (type) {
      case 'tool':
        return this.getToolCache(name);
      case 'command':
        return this.getCommandCache(name);
      case 'resource':
        return this.getResourceCache(name);
      case 'capability':
        return this.getCapabilitiesCache(name);
      default:
        return null;
    }
  }

  set(key: string, value: unknown, ttl?: number): void {
    const [type, ...nameParts] = key.split(':');
    const name = nameParts.join(':');

    switch (type) {
      case 'tool':
        this.setToolCache(name, value as SerializedTool[], ttl);
        break;
      case 'command':
        this.setCommandCache(name, value as Command[], ttl);
        break;
      case 'resource':
        this.setResourceCache(name, value as ServerResource[], ttl);
        break;
      case 'capability':
        this.setCapabilitiesCache(name, value, ttl);
        break;
    }
  }

  delete(key: string): boolean {
    const [type, ...nameParts] = key.split(':');
    const name = nameParts.join(':');

    switch (type) {
      case 'tool':
        return this.toolCache.delete(name);
      case 'command':
        return this.commandCache.delete(name);
      case 'resource':
        return this.resourceCache.delete(name);
      case 'capability':
        return this.capabilitiesCache.delete(name);
      default:
        return false;
    }
  }

  clear(): void {
    this.clearAllCache();
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  size(): number {
    return (
      this.toolCache.size +
      this.commandCache.size +
      this.resourceCache.size +
      this.capabilitiesCache.size
    );
  }

  getStats(): CacheStats {
    const total = this.size();
    return {
      size: total,
      hits: 0,
      misses: 0,
      expirations: 0,
      cleanups: 0,
    };
  }

  setToolCache(
    serverName: string,
    tools: SerializedTool[],
    ttl?: number
  ): void {
    this.toolCache.set(serverName, {
      data: tools,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL,
    });
    logger.debug(
      `Set tool cache for server ${serverName}: ${tools.length} tools`
    );
  }

  getToolCache(serverName: string): SerializedTool[] | null {
    const cache = this.toolCache.get(serverName);
    if (!cache) return null;

    if (Date.now() - cache.timestamp > cache.ttl) {
      this.toolCache.delete(serverName);
      return null;
    }

    return cache.data;
  }

  setCommandCache(serverName: string, commands: Command[], ttl?: number): void {
    this.commandCache.set(serverName, {
      data: commands,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL,
    });
    logger.debug(
      `Set command cache for server ${serverName}: ${commands.length} commands`
    );
  }

  getCommandCache(serverName: string): Command[] | null {
    const cache = this.commandCache.get(serverName);
    if (!cache) return null;

    if (Date.now() - cache.timestamp > cache.ttl) {
      this.commandCache.delete(serverName);
      return null;
    }

    return cache.data;
  }

  setResourceCache(
    serverName: string,
    resources: ServerResource[],
    ttl?: number
  ): void {
    this.resourceCache.set(serverName, {
      data: resources,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL,
    });
    logger.debug(
      `Set resource cache for server ${serverName}: ${resources.length} resources`
    );
  }

  getResourceCache(serverName: string): ServerResource[] | null {
    const cache = this.resourceCache.get(serverName);
    if (!cache) return null;

    if (Date.now() - cache.timestamp > cache.ttl) {
      this.resourceCache.delete(serverName);
      return null;
    }

    return cache.data;
  }

  setCapabilitiesCache(
    serverName: string,
    capabilities: unknown,
    ttl?: number
  ): void {
    this.capabilitiesCache.set(serverName, {
      data: capabilities,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL,
    });
    logger.debug(`Set capabilities cache for server ${serverName}`);
  }

  getCapabilitiesCache(serverName: string): unknown | null {
    const cache = this.capabilitiesCache.get(serverName);
    if (!cache) return null;

    if (Date.now() - cache.timestamp > cache.ttl) {
      this.capabilitiesCache.delete(serverName);
      return null;
    }

    return cache.data;
  }

  clearServerCache(serverName: string): void {
    this.toolCache.delete(serverName);
    this.commandCache.delete(serverName);
    this.resourceCache.delete(serverName);
    this.capabilitiesCache.delete(serverName);
    logger.debug(`Cleared all cache for server ${serverName}`);
  }

  clearAllCache(): void {
    this.toolCache.clear();
    this.commandCache.clear();
    this.resourceCache.clear();
    this.capabilitiesCache.clear();
    logger.debug('Cleared all MCP cache');
  }

  getCacheStatsInfo(): {
    toolCacheSize: number;
    commandCacheSize: number;
    resourceCacheSize: number;
    capabilitiesCacheSize: number;
  } {
    return {
      toolCacheSize: this.toolCache.size,
      commandCacheSize: this.commandCache.size,
      resourceCacheSize: this.resourceCache.size,
      capabilitiesCacheSize: this.capabilitiesCache.size,
    };
  }
}

export const mcpCacheManager = new MCPCacheManager();
