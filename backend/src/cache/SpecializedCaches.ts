/**
 * 专用缓存
 * 为不同场景优化存储和访问策略
 */

import { getCacheSystem } from './CacheSystem.js';
import { logForDebugging } from '../utils/debug.js';

/**
 * 工具模式缓存
 */
export class ToolModeCache {
  private cacheKey = 'tool_mode_cache';
  private cache = getCacheSystem();

  /**
   * 设置工具模式
   */
  async setToolMode(toolName: string, mode: string): Promise<void> {
    const data = await this.getAllToolModes();
    data[toolName] = mode;
    await this.cache.set(this.cacheKey, data);
    logForDebugging(`工具模式已设置: ${toolName} -> ${mode}`);
  }

  /**
   * 获取工具模式
   */
  async getToolMode(toolName: string): Promise<string | undefined> {
    const data = await this.getAllToolModes();
    return data[toolName];
  }

  /**
   * 获取所有工具模式
   */
  async getAllToolModes(): Promise<Record<string, string>> {
    const data = await this.cache.get<Record<string, string>>(this.cacheKey);
    return data || {};
  }

  /**
   * 清除工具模式
   */
  async clearToolMode(toolName: string): Promise<void> {
    const data = await this.getAllToolModes();
    delete data[toolName];
    await this.cache.set(this.cacheKey, data);
    logForDebugging(`工具模式已清除: ${toolName}`);
  }

  /**
   * 清空所有工具模式
   */
  async clearAllToolModes(): Promise<void> {
    await this.cache.delete(this.cacheKey);
    logForDebugging('所有工具模式已清空');
  }
}

/**
 * 设置缓存
 */
export class SettingsCache {
  private cacheKey = 'settings_cache';
  private cache = getCacheSystem();
  private ttl = 3600000; // 1小时

  /**
   * 设置设置项
   */
  async setSetting(key: string, value: any): Promise<void> {
    const data = await this.getAllSettings();
    data[key] = value;
    await this.cache.set(this.cacheKey, data, { expiry: Date.now() + this.ttl });
    logForDebugging(`设置已缓存: ${key}`);
  }

  /**
   * 获取设置项
   */
  async getSetting(key: string): Promise<any> {
    const data = await this.getAllSettings();
    return data[key];
  }

  /**
   * 获取所有设置项
   */
  async getAllSettings(): Promise<Record<string, any>> {
    const data = await this.cache.get<Record<string, any>>(this.cacheKey);
    return data || {};
  }

  /**
   * 清除设置项
   */
  async clearSetting(key: string): Promise<void> {
    const data = await this.getAllSettings();
    delete data[key];
    await this.cache.set(this.cacheKey, data, { expiry: Date.now() + this.ttl });
    logForDebugging(`设置已清除: ${key}`);
  }

  /**
   * 清空所有设置项
   */
  async clearAllSettings(): Promise<void> {
    await this.cache.delete(this.cacheKey);
    logForDebugging('所有设置已清空');
  }

  /**
   * 设置TTL
   */
  setTTL(ttl: number): void {
    this.ttl = ttl;
  }
}

/**
 * 插件缓存
 */
export class PluginCache {
  private cacheKeyPrefix = 'plugin_';
  private cache = getCacheSystem();

  /**
   * 设置插件数据
   */
  async setPluginData(pluginName: string, key: string, value: any): Promise<void> {
    const cacheKey = `${this.cacheKeyPrefix}${pluginName}`;
    const data = await this.getPluginData(pluginName);
    data[key] = value;
    await this.cache.set(cacheKey, data);
    logForDebugging(`插件数据已缓存: ${pluginName}.${key}`);
  }

  /**
   * 获取插件数据
   */
  async getPluginData(pluginName: string, key?: string): Promise<any> {
    const cacheKey = `${this.cacheKeyPrefix}${pluginName}`;
    const data = await this.cache.get<Record<string, any>>(cacheKey);
    if (!data) return key ? undefined : {};
    return key ? data[key] : data;
  }

  /**
   * 清除插件数据
   */
  async clearPluginData(pluginName: string, key?: string): Promise<void> {
    const cacheKey = `${this.cacheKeyPrefix}${pluginName}`;
    if (key) {
      const data = await this.getPluginData(pluginName);
      delete data[key];
      await this.cache.set(cacheKey, data);
      logForDebugging(`插件数据已清除: ${pluginName}.${key}`);
    } else {
      await this.cache.delete(cacheKey);
      logForDebugging(`插件数据已清空: ${pluginName}`);
    }
  }

  /**
   * 清空所有插件数据
   */
  async clearAllPluginData(): Promise<void> {
    const keys = await this.cache.keys();
    for (const key of keys) {
      if (key.startsWith(this.cacheKeyPrefix)) {
        await this.cache.delete(key);
      }
    }
    logForDebugging('所有插件数据已清空');
  }
}

/**
 * 会话缓存
 */
export class SessionCache {
  private cacheKeyPrefix = 'session_';
  private cache = getCacheSystem();
  private ttl = 86400000; // 24小时

  /**
   * 设置会话数据
   */
  async setSessionData(sessionId: string, key: string, value: any): Promise<void> {
    const cacheKey = `${this.cacheKeyPrefix}${sessionId}`;
    const data = await this.getSessionData(sessionId);
    data[key] = value;
    await this.cache.set(cacheKey, data, { expiry: Date.now() + this.ttl });
    logForDebugging(`会话数据已缓存: ${sessionId}.${key}`);
  }

  /**
   * 获取会话数据
   */
  async getSessionData(sessionId: string, key?: string): Promise<any> {
    const cacheKey = `${this.cacheKeyPrefix}${sessionId}`;
    const data = await this.cache.get<Record<string, any>>(cacheKey);
    if (!data) return key ? undefined : {};
    return key ? data[key] : data;
  }

  /**
   * 清除会话数据
   */
  async clearSessionData(sessionId: string, key?: string): Promise<void> {
    const cacheKey = `${this.cacheKeyPrefix}${sessionId}`;
    if (key) {
      const data = await this.getSessionData(sessionId);
      delete data[key];
      await this.cache.set(cacheKey, data, { expiry: Date.now() + this.ttl });
      logForDebugging(`会话数据已清除: ${sessionId}.${key}`);
    } else {
      await this.cache.delete(cacheKey);
      logForDebugging(`会话数据已清空: ${sessionId}`);
    }
  }

  /**
   * 清空所有会话数据
   */
  async clearAllSessionData(): Promise<void> {
    const keys = await this.cache.keys();
    for (const key of keys) {
      if (key.startsWith(this.cacheKeyPrefix)) {
        await this.cache.delete(key);
      }
    }
    logForDebugging('所有会话数据已清空');
  }

  /**
   * 设置TTL
   */
  setTTL(ttl: number): void {
    this.ttl = ttl;
  }
}

/**
 * 工具结果缓存
 */
export class ToolResultCache {
  private cacheKeyPrefix = 'tool_result_';
  private cache = getCacheSystem();
  private ttl = 300000; // 5分钟

  /**
   * 缓存工具结果
   */
  async cacheToolResult(toolName: string, args: any, result: any): Promise<string> {
    const key = this.generateKey(toolName, args);
    const cacheKey = `${this.cacheKeyPrefix}${key}`;
    await this.cache.set(cacheKey, result, { expiry: Date.now() + this.ttl });
    logForDebugging(`工具结果已缓存: ${toolName}`);
    return key;
  }

  /**
   * 获取工具结果
   */
  async getToolResult(toolName: string, args: any): Promise<any> {
    const key = this.generateKey(toolName, args);
    const cacheKey = `${this.cacheKeyPrefix}${key}`;
    return await this.cache.get(cacheKey);
  }

  /**
   * 获取工具结果（通过键）
   */
  async getToolResultByKey(key: string): Promise<any> {
    const cacheKey = `${this.cacheKeyPrefix}${key}`;
    return await this.cache.get(cacheKey);
  }

  /**
   * 清除工具结果
   */
  async clearToolResult(toolName: string, args: any): Promise<void> {
    const key = this.generateKey(toolName, args);
    const cacheKey = `${this.cacheKeyPrefix}${key}`;
    await this.cache.delete(cacheKey);
    logForDebugging(`工具结果已清除: ${toolName}`);
  }

  /**
   * 清空所有工具结果
   */
  async clearAllToolResults(): Promise<void> {
    const keys = await this.cache.keys();
    for (const key of keys) {
      if (key.startsWith(this.cacheKeyPrefix)) {
        await this.cache.delete(key);
      }
    }
    logForDebugging('所有工具结果已清空');
  }

  /**
   * 设置TTL
   */
  setTTL(ttl: number): void {
    this.ttl = ttl;
  }

  /**
   * 生成缓存键
   */
  private generateKey(toolName: string, args: any): string {
    const argsStr = JSON.stringify(args);
    const hash = this.hashCode(`${toolName}:${argsStr}`);
    return `${toolName}_${hash}`;
  }

  /**
   * 生成哈希码
   */
  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转换为32位整数
    }
    return Math.abs(hash);
  }
}

/**
 * 全局专用缓存实例
 */
export const toolModeCache = new ToolModeCache();
export const settingsCache = new SettingsCache();
export const pluginCache = new PluginCache();
export const sessionCache = new SessionCache();
export const toolResultCache = new ToolResultCache();

/**
 * 获取专用缓存实例
 */
export function getToolModeCache(): ToolModeCache {
  return toolModeCache;
}

export function getSettingsCache(): SettingsCache {
  return settingsCache;
}

export function getPluginCache(): PluginCache {
  return pluginCache;
}

export function getSessionCache(): SessionCache {
  return sessionCache;
}

export function getToolResultCache(): ToolResultCache {
  return toolResultCache;
}
