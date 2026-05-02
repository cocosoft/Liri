/**
 * 工具执行缓存管理器
 * 负责存储和管理工具执行的结果
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * 缓存项类型
 */
export interface ToolCacheItem {
  key: string;
  toolName: string;
  input: Record<string, unknown>;
  result: unknown;
  timestamp: number;
  expiration: number | null;
}

/**
 * 工具执行缓存管理器
 */
export class ToolCacheManager {
  private cache: Map<string, ToolCacheItem> = new Map();
  private cachePath: string;
  private maxCacheSize: number;
  private defaultExpiration: number | null;

  /**
   * 构造函数
   * @param cachePath 缓存文件路径
   * @param maxCacheSize 最大缓存项数量
   * @param defaultExpiration 默认过期时间（毫秒）
   */
  constructor(
    cachePath: string = path.join(
      process.env.HOME || process.env.USERPROFILE || '.',
      '.py_app',
      'tool_cache.json'
    ),
    maxCacheSize: number = 1000,
    defaultExpiration: number | null = 24 * 60 * 60 * 1000 // 24小时
  ) {
    this.cachePath = cachePath;
    this.maxCacheSize = maxCacheSize;
    this.defaultExpiration = defaultExpiration;
    this.loadCache();
  }

  /**
   * 生成缓存键
   * @param toolName 工具名称
   * @param input 工具输入
   * @returns 缓存键
   */
  generateCacheKey(toolName: string, input: Record<string, unknown>): string {
    const inputString = JSON.stringify(input, Object.keys(input).sort());
    const data = `${toolName}:${inputString}`;
    return crypto.createHash('md5').update(data).digest('hex');
  }

  /**
   * 加载缓存
   */
  private loadCache(): void {
    try {
      // 确保目录存在
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(this.cachePath)) {
        const content = fs.readFileSync(this.cachePath, 'utf8');
        const items: ToolCacheItem[] = JSON.parse(content);

        // 过滤过期的缓存项
        const now = Date.now();
        for (const item of items) {
          if (!item.expiration || item.expiration > now) {
            this.cache.set(item.key, item);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load tool cache:', error);
      this.cache = new Map();
    }
  }

  /**
   * 保存缓存
   */
  private saveCache(): void {
    try {
      // 确保目录存在
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 限制缓存大小
      if (this.cache.size > this.maxCacheSize) {
        const items = Array.from(this.cache.values())
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, this.maxCacheSize);

        this.cache = new Map();
        for (const item of items) {
          this.cache.set(item.key, item);
        }
      }

      const items = Array.from(this.cache.values());
      fs.writeFileSync(this.cachePath, JSON.stringify(items, null, 2));
    } catch (error) {
      console.warn('Failed to save tool cache:', error);
    }
  }

  /**
   * 获取缓存项
   * @param key 缓存键
   * @returns 缓存项或undefined
   */
  getCache(key: string): ToolCacheItem | undefined {
    const item = this.cache.get(key);
    if (!item) return undefined;

    // 检查是否过期
    if (item.expiration && item.expiration < Date.now()) {
      this.cache.delete(key);
      this.saveCache();
      return undefined;
    }

    return item;
  }

  /**
   * 设置缓存项
   * @param toolName 工具名称
   * @param input 工具输入
   * @param result 工具执行结果
   * @param expiration 过期时间（毫秒）
   * @returns 缓存键
   */
  setCache(
    toolName: string,
    input: Record<string, unknown>,
    result: unknown,
    expiration: number | null = this.defaultExpiration
  ): string {
    const key = this.generateCacheKey(toolName, input);
    const item: ToolCacheItem = {
      key,
      toolName,
      input,
      result,
      timestamp: Date.now(),
      expiration: expiration ? Date.now() + expiration : null,
    };

    this.cache.set(key, item);
    this.saveCache();
    return key;
  }

  /**
   * 删除缓存项
   * @param key 缓存键
   */
  deleteCache(key: string): void {
    this.cache.delete(key);
    this.saveCache();
  }

  /**
   * 清除所有缓存
   */
  clearCache(): void {
    this.cache.clear();
    this.saveCache();
  }

  /**
   * 清除指定工具的缓存
   * @param toolName 工具名称
   */
  clearToolCache(toolName: string): void {
    for (const [key, item] of this.cache.entries()) {
      if (item.toolName === toolName) {
        this.cache.delete(key);
      }
    }
    this.saveCache();
  }

  /**
   * 获取缓存大小
   * @returns 缓存项数量
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * 获取缓存统计信息
   * @returns 缓存统计信息
   */
  getCacheStats(): {
    total: number;
    tools: Record<string, number>;
    oldest: number | null;
    newest: number | null;
  } {
    const items = Array.from(this.cache.values());
    const tools: Record<string, number> = {};
    let oldest: number | null = null;
    let newest: number | null = null;

    for (const item of items) {
      if (tools[item.toolName]) {
        tools[item.toolName]++;
      } else {
        tools[item.toolName] = 1;
      }

      if (!oldest || item.timestamp < oldest) {
        oldest = item.timestamp;
      }

      if (!newest || item.timestamp > newest) {
        newest = item.timestamp;
      }
    }

    return {
      total: items.length,
      tools,
      oldest,
      newest,
    };
  }
}

/**
 * 全局工具执行缓存管理器实例
 */
export const toolCacheManager = new ToolCacheManager();
