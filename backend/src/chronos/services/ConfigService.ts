//
/**
 * 配置管理服务
 * 实现基于GrowthBook的配置管理和配置热更新
 * 参考CC源码: cc_code/backend/utils/cronJitterConfig.ts
 */

import { EventEmitter } from 'events';

/**
 * 配置项
 */
export interface ConfigItem<T = unknown> {
  key: string;
  value: T;
  type: string;
  description?: string;
  defaultValue?: T;
  validator?: (value: T) => boolean;
  onChange?: (value: T, oldValue: T) => void;
}

/**
 * 配置变更事件
 */
export interface ConfigChangeEvent {
  key: string;
  oldValue: unknown;
  newValue: unknown;
  timestamp: number;
}

/**
 * 配置统计
 */
export interface ConfigStats {
  totalConfigs: number;
  activeConfigs: number;
  changeCount: number;
  lastChangeTime: number;
}

/**
 * 配置服务类
 */
export class ConfigService extends EventEmitter {
  private static instance: ConfigService;
  private configs: Map<string, ConfigItem> = new Map();
  private changeHistory: ConfigChangeEvent[] = [];
  private maxHistorySize: number = 100;
  private stats = {
    changeCount: 0,
    lastChangeTime: 0,
  };
  private hotUpdateEnabled: boolean = false;
  private hotUpdateInterval: NodeJS.Timeout | null = null;
  private hotUpdateIntervalMs: number = 60000;

  private constructor() {
    super();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  /**
   * 注册配置项
   * @param config 配置项
   */
  registerConfig<T>(config: ConfigItem<T>): void {
    if (this.configs.has(config.key)) {
      console.warn(`Config ${config.key} already registered, skipping`);
      return;
    }

    this.configs.set(config.key, {
      ...config,
      type: typeof config.value,
    });

    this.emit('configRegistered', config);
  }

  /**
   * 批量注册配置项
   * @param configs 配置项数组
   */
  registerConfigs(configs: ConfigItem[]): void {
    for (const config of configs) {
      this.registerConfig(config);
    }
  }

  /**
   * 获取配置值
   * @param key 配置键
   * @returns 配置值
   */
  get<T>(key: string): T | undefined {
    const config = this.configs.get(key);
    return config?.value as T | undefined;
  }

  /**
   * 获取配置项
   * @param key 配置键
   * @returns 配置项
   */
  getConfig(key: string): ConfigItem | undefined {
    return this.configs.get(key);
  }

  /**
   * 获取所有配置
   * @returns 所有配置
   */
  getAllConfigs(): ConfigItem[] {
    return Array.from(this.configs.values());
  }

  /**
   * 设置配置值
   * @param key 配置键
   * @param value 配置值
   * @param emitChange 是否触发变更事件
   * @returns 是否成功
   */
  set<T>(key: string, value: T, emitChange: boolean = true): boolean {
    const config = this.configs.get(key);
    if (!config) {
      console.warn(`Config ${key} not registered`);
      return false;
    }

    if (config.validator && !config.validator(value)) {
      console.warn(`Config ${key} validation failed`);
      return false;
    }

    const oldValue = config.value;
    (config as ConfigItem<T>).value = value;

    if (emitChange) {
      this.recordChange(key, oldValue, value);

      if (config.onChange) {
        config.onChange(value, oldValue);
      }
    }

    this.emit('configChanged', { key, oldValue, newValue: value });

    return true;
  }

  /**
   * 批量设置配置
   * @param configs 配置对象
   */
  setMultiple(configs: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(configs)) {
      this.set(key, value);
    }
  }

  /**
   * 删除配置
   * @param key 配置键
   * @returns 是否成功
   */
  delete(key: string): boolean {
    if (!this.configs.has(key)) {
      return false;
    }

    const config = this.configs.get(key);
    this.configs.delete(key);
    this.emit('configDeleted', config);

    return true;
  }

  /**
   * 重置配置到默认值
   * @param key 配置键
   * @returns 是否成功
   */
  reset(key: string): boolean {
    const config = this.configs.get(key);
    if (!config || config.defaultValue === undefined) {
      return false;
    }

    return this.set(key, config.defaultValue);
  }

  /**
   * 重置所有配置到默认值
   * @returns 重置的配置数量
   */
  resetAll(): number {
    let count = 0;
    for (const [key, config] of this.configs) {
      if (config.defaultValue !== undefined) {
        this.set(key, config.defaultValue);
        count++;
      }
    }
    return count;
  }

  /**
   * 检查配置是否存在
   * @param key 配置键
   * @returns 是否存在
   */
  has(key: string): boolean {
    return this.configs.has(key);
  }

  /**
   * 获取配置类型
   * @param key 配置键
   * @returns 配置类型
   */
  getType(key: string): string | undefined {
    return this.configs.get(key)?.type;
  }

  /**
   * 获取配置描述
   * @param key 配置键
   * @returns 配置描述
   */
  getDescription(key: string): string | undefined {
    return this.configs.get(key)?.description;
  }

  /**
   * 获取配置统计
   * @returns 配置统计
   */
  getStats(): ConfigStats {
    return {
      totalConfigs: this.configs.size,
      activeConfigs: this.configs.size,
      changeCount: this.stats.changeCount,
      lastChangeTime: this.stats.lastChangeTime,
    };
  }

  /**
   * 获取变更历史
   * @param limit 限制数量
   * @returns 变更历史
   */
  getChangeHistory(limit?: number): ConfigChangeEvent[] {
    const history = [...this.changeHistory].reverse();
    return limit ? history.slice(0, limit) : history;
  }

  /**
   * 记录配置变更
   * @param key 配置键
   * @param oldValue 旧值
   * @param newValue 新值
   */
  private recordChange(key: string, oldValue: unknown, newValue: unknown): void {
    this.stats.changeCount++;
    this.stats.lastChangeTime = Date.now();

    const event: ConfigChangeEvent = {
      key,
      oldValue,
      newValue,
      timestamp: Date.now(),
    };

    this.changeHistory.push(event);

    if (this.changeHistory.length > this.maxHistorySize) {
      this.changeHistory.shift();
    }

    this.emit('configChanged', event);
  }

  /**
   * 清除变更历史
   */
  clearChangeHistory(): void {
    this.changeHistory = [];
  }

  /**
   * 启动热更新
   * @param intervalMs 更新间隔（毫秒）
   * @param updateFn 更新函数
   */
  startHotUpdate(intervalMs: number, updateFn: () => Promise<void>): void {
    if (this.hotUpdateEnabled) {
      return;
    }

    this.hotUpdateEnabled = true;
    this.hotUpdateIntervalMs = intervalMs;

    this.hotUpdateInterval = setInterval(async () => {
      try {
        await updateFn();
        this.emit('hotUpdateComplete');
      } catch (error) {
        this.emit('hotUpdateError', error);
      }
    }, intervalMs);

    this.emit('hotUpdateStarted');
  }

  /**
   * 停止热更新
   */
  stopHotUpdate(): void {
    if (this.hotUpdateInterval) {
      clearInterval(this.hotUpdateInterval);
      this.hotUpdateInterval = null;
      this.hotUpdateEnabled = false;
      this.emit('hotUpdateStopped');
    }
  }

  /**
   * 检查热更新是否已启动
   * @returns 是否已启动
   */
  isHotUpdateEnabled(): boolean {
    return this.hotUpdateEnabled;
  }

  /**
   * 导出配置
   * @param format 导出格式
   * @returns 导出的配置
   */
  exportConfigs(format: 'json' | 'object' = 'json'): string | Record<string, unknown> {
    const configObj: Record<string, unknown> = {};

    for (const [key, config] of this.configs) {
      configObj[key] = config.value;
    }

    if (format === 'json') {
      return JSON.stringify(configObj, null, 2);
    }

    return configObj;
  }

  /**
   * 导入配置
   * @param configs 配置对象
   * @param merge 是否合并（false则替换）
   */
  importConfigs(configs: Record<string, unknown>, merge: boolean = true): void {
    if (!merge) {
      this.configs.clear();
    }

    for (const [key, value] of Object.entries(configs)) {
      if (this.configs.has(key)) {
        this.set(key, value);
      } else {
        this.registerConfig({
          key,
          value,
          type: typeof value,
        });
      }
    }
  }

  /**
   * 验证配置
   * @param key 配置键
   * @param value 配置值
   * @returns 是否有效
   */
  validate(key: string, value: unknown): boolean {
    const config = this.configs.get(key);
    if (!config) {
      return false;
    }

    if (config.validator) {
      return config.validator(value as never);
    }

    return true;
  }

  /**
   * 订阅配置变更
   * @param key 配置键
   * @param callback 回调函数
   * @returns 取消订阅函数
   */
  subscribe(key: string, callback: (value: unknown, oldValue: unknown) => void): () => void {
    const handler = (event: ConfigChangeEvent) => {
      if (event.key === key) {
        callback(event.newValue, event.oldValue);
      }
    };

    this.on('configChanged', handler);

    return () => {
      this.off('configChanged', handler);
    };
  }

  /**
   * 清除所有配置
   */
  clearAllConfigs(): void {
    this.configs.clear();
    this.emit('allConfigsCleared');
  }

  /**
   * 重置服务
   */
  reset(): void {
    this.stopHotUpdate();
    this.clearAllConfigs();
    this.clearChangeHistory();
    this.stats = {
      changeCount: 0,
      lastChangeTime: 0,
    };
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
export const configService = ConfigService.getInstance();
