// @ts-nocheck
/**
 * 多层配置管理器
 * 参考CC源码的配置管理模式，提供多层级配置合并机制
 * 包括：环境变量、用户配置、项目配置、策略配置、默认配置
 */

import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { logger } from '../../utils/log.js';

/**
 * 配置来源类型
 */
export type ConfigSource =
  | 'default'
  | 'env'
  | 'user'
  | 'project'
  | 'policy'
  | 'runtime';

/**
 * 配置层定义
 */
export interface ConfigLayer {
  /** 层名称 */
  name: ConfigSource;
  /** 优先级（数字越大优先级越高） */
  priority: number;
  /** 获取配置 */
  get(): Record<string, any>;
  /** 设置配置 */
  set?(key: string, value: any): void;
  /** 是否包含键 */
  has?(key: string): boolean;
}

/**
 * 配置变更事件
 */
export interface ConfigChangeEvent {
  /** 变更的键 */
  key: string;
  /** 旧值 */
  oldValue: any;
  /** 新值 */
  newValue: any;
  /** 变更来源 */
  source: ConfigSource;
}

/**
 * 配置管理器配置
 */
export interface ConfigManagerConfig {
  /** 是否启用缓存 */
  enableCache?: boolean;
  /** 缓存过期时间（毫秒） */
  cacheTtlMs?: number;
  /** 是否启用配置验证 */
  enableValidation?: boolean;
}

/**
 * 运行时配置层（可读写）
 */
export class RuntimeConfigLayer implements ConfigLayer {
  name: ConfigSource = 'runtime';
  priority = 200;

  private data: Record<string, any> = {};

  get(): Record<string, any> {
    return { ...this.data };
  }

  set(key: string, value: any): void {
    this.data[key] = value;
  }

  has(key: string): boolean {
    return key in this.data;
  }
}

/**
 * 多层配置管理器
 */
export class ConfigManager extends EventEmitter {
  private static instance: ConfigManager;
  private layers: Map<string, ConfigLayer>;
  private mergedCache: Record<string, any> | null;
  private cacheTimestamp: number;
  private config: ConfigManagerConfig;

  private constructor(config?: ConfigManagerConfig) {
    super();
    this.layers = new Map();
    this.mergedCache = null;
    this.cacheTimestamp = 0;
    this.config = {
      enableCache: true,
      cacheTtlMs: 1000,
      enableValidation: false,
      ...config,
    };

    // 自动注册运行时配置层
    this.layers.set('runtime', new RuntimeConfigLayer());
  }

  /**
   * 获取单例实例
   */
  static getInstance(config?: ConfigManagerConfig): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager(config);
    }
    return ConfigManager.instance;
  }

  /**
   * 注册配置层
   * @param layer 配置层定义
   */
  registerLayer(layer: ConfigLayer): void {
    if (this.layers.has(layer.name)) {
      logger.warn(`Config layer already registered: ${layer.name}`);
      return;
    }

    this.layers.set(layer.name, layer);
    this.invalidateCache();
    logger.debug(`Registered config layer: ${layer.name} (priority: ${layer.priority})`);
  }

  /**
   * 获取配置值
   * @param key 配置键
   */
  get(key: string): any {
    const merged = this.getMergedConfig();
    return merged[key];
  }

  /**
   * 获取配置值（带默认值）
   * @param key 配置键
   * @param defaultValue 默认值
   */
  getWithDefault<T>(key: string, defaultValue: T): T {
    const value = this.get(key);
    return value !== undefined ? value : defaultValue;
  }

  /**
   * 设置配置值
   * @param key 配置键
   * @param value 配置值
   * @param source 配置来源
   */
  set(key: string, value: any, source: ConfigSource = 'runtime'): void {
    const layer = this.layers.get(source);
    
    if (!layer || !layer.set) {
      logger.warn(`Config layer ${source} does not support setting values`);
      return;
    }

    const oldValue = this.get(key);
    layer.set(key, value);
    this.invalidateCache();

    this.emit('change', {
      key,
      oldValue,
      newValue: value,
      source,
    } as ConfigChangeEvent);

    logger.debug(`Config updated: ${key} = ${value} (source: ${source})`);
  }

  /**
   * 获取合并后的完整配置
   */
  getMergedConfig(): Record<string, any> {
    if (this.config.enableCache && this.isCacheValid()) {
      return this.mergedCache!;
    }

    const merged = this.mergeLayers();
    
    if (this.config.enableCache) {
      this.mergedCache = merged;
      this.cacheTimestamp = Date.now();
    }

    return merged;
  }

  /**
   * 检查键是否存在
   * @param key 配置键
   */
  has(key: string): boolean {
    const merged = this.getMergedConfig();
    return key in merged;
  }

  /**
   * 获取所有配置键
   */
  keys(): string[] {
    const merged = this.getMergedConfig();
    return Object.keys(merged);
  }

  /**
   * 获取配置统计信息
   */
  getStats(): {
    layerCount: number;
    keyCount: number;
    cacheValid: boolean;
  } {
    return {
      layerCount: this.layers.size,
      keyCount: this.keys().length,
      cacheValid: this.isCacheValid(),
    };
  }

  /**
   * 清除缓存
   */
  invalidateCache(): void {
    this.mergedCache = null;
    this.cacheTimestamp = 0;
  }

  /**
   * 重置所有配置层
   */
  reset(): void {
    this.layers.clear();
    this.invalidateCache();
    // 重新注册运行时配置层
    this.layers.set('runtime', new RuntimeConfigLayer());
    logger.info('All config layers cleared');
  }

  /**
   * 重置单例（主要用于测试）
   */
  static resetInstance(): void {
    if (ConfigManager.instance) {
      ConfigManager.instance.removeAllListeners();
      ConfigManager.instance.reset();
      ConfigManager.instance = undefined as any;
    }
  }

  /**
   * 检查缓存是否有效
   */
  private isCacheValid(): boolean {
    if (!this.mergedCache) {
      return false;
    }

    return Date.now() - this.cacheTimestamp < this.config.cacheTtlMs;
  }

  /**
   * 合并所有配置层
   */
  private mergeLayers(): Record<string, any> {
    const sortedLayers = Array.from(this.layers.values())
      .sort((a, b) => a.priority - b.priority);

    let merged: Record<string, any> = {};

    for (const layer of sortedLayers) {
      const layerConfig = layer.get();
      merged = this.deepMerge(merged, layerConfig);
    }

    return merged;
  }

  /**
   * 深度合并两个对象
   */
  private deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
    const result = { ...target };

    for (const key of Object.keys(source)) {
      if (
        source[key] &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        target[key] &&
        typeof target[key] === 'object' &&
        !Array.isArray(target[key])
      ) {
        result[key] = this.deepMerge(target[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }
}

/**
 * 默认配置层
 */
export class DefaultConfigLayer implements ConfigLayer {
  name: ConfigSource = 'default';
  priority = 0;

  private defaults: Record<string, any>;

  constructor(defaults: Record<string, any> = {}) {
    this.defaults = defaults;
  }

  get(): Record<string, any> {
    return { ...this.defaults };
  }

  set(key: string, value: any): void {
    this.defaults[key] = value;
  }

  has(key: string): boolean {
    return key in this.defaults;
  }
}

/**
 * 环境变量配置层
 */
export class EnvConfigLayer implements ConfigLayer {
  name: ConfigSource = 'env';
  priority = 100;

  private prefix: string;
  private cache: Record<string, any> | null = null;

  constructor(prefix: string = 'PYAPP_') {
    this.prefix = prefix;
  }

  get(): Record<string, any> {
    if (this.cache) {
      return this.cache;
    }

    const config: Record<string, any> = {};

    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith(this.prefix) && value !== undefined) {
        const configKey = key.substring(this.prefix.length).toLowerCase();
        config[configKey] = this.parseEnvValue(value);
      }
    }

    this.cache = config;
    return config;
  }

  /**
   * 解析环境变量值
   */
  private parseEnvValue(value: string): any {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    
    const num = Number(value);
    if (!isNaN(num)) return num;

    return value;
  }
}

/**
 * 文件配置层
 */
export class FileConfigLayer implements ConfigLayer {
  name: ConfigSource;
  priority: number;

  private filePath: string;
  private cache: Record<string, any> | null = null;

  constructor(name: ConfigSource, filePath: string, priority: number) {
    this.name = name;
    this.filePath = filePath;
    this.priority = priority;
  }

  get(): Record<string, any> {
    if (this.cache) {
      return this.cache;
    }

    try {
      if (!existsSync(this.filePath)) {
        return {};
      }

      const content = readFileSync(this.filePath, 'utf-8');
      const config = JSON.parse(content);
      this.cache = config;
      return config;
    } catch (error) {
      logger.warn(`Failed to load config from ${this.filePath}:`, error);
      return {};
    }
  }

  set(key: string, value: any): void {
    try {
      const config = this.get();
      config[key] = value;

      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(this.filePath, JSON.stringify(config, null, 2), 'utf-8');
      this.cache = config;
    } catch (error) {
      logger.error(`Failed to save config to ${this.filePath}:`, error);
    }
  }

  has(key: string): boolean {
    const config = this.get();
    return key in config;
  }
}

/**
 * 便捷函数：获取配置值
 */
export function getConfig<T = any>(key: string): T | undefined {
  return ConfigManager.getInstance().get(key);
}

/**
 * 便捷函数：设置配置值
 */
export function setConfig(key: string, value: any, source?: ConfigSource): void {
  ConfigManager.getInstance().set(key, value, source);
}

/**
 * 便捷函数：获取合并后的配置
 */
export function getMergedConfig(): Record<string, any> {
  return ConfigManager.getInstance().getMergedConfig();
}
