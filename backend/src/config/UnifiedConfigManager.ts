// @ts-nocheck
/**
 * 统一配置管理器
 * 整合 ConfigLoader、HotReloader、VersionController、RemoteConfigManager 等子系统
 * 提供统一的配置访问入口，支持多源设置管理
 * 基于CC源码 cc_code/backend/utils/settings/settings.ts 的多源设计
 */

import { logger } from '../utils/log.js';
import { ConfigLoader, type ConfigSource, type ConfigLoadResult } from './loader/ConfigLoader.js';
import { HotReloader, type ReloadEvent, type ReloadListener, type HotReloadConfig } from './hotreload/HotReloader.js';
import { VersionController, type ConfigSnapshot, type ConfigDiff, type VersionInfo } from './version/VersionController.js';
import { ConfigManager } from './ConfigManager.js';

/**
 * 设置源类型
 * 优先级从低到高：userSettings < projectSettings < localSettings < flagSettings < policySettings
 */
export const SETTING_SOURCES = [
  'userSettings',
  'projectSettings',
  'localSettings',
  'flagSettings',
  'policySettings',
] as const;

export type SettingSource = (typeof SETTING_SOURCES)[number];

/**
 * 可编辑的设置源（排除policySettings和flagSettings）
 */
export type EditableSettingSource = Exclude<
  SettingSource,
  'policySettings' | 'flagSettings'
>;

/**
 * 设置源显示名称
 */
export function getSettingSourceName(source: SettingSource): string {
  switch (source) {
    case 'userSettings':
      return '用户设置';
    case 'projectSettings':
      return '项目设置';
    case 'localSettings':
      return '本地设置';
    case 'flagSettings':
      return '命令行标志';
    case 'policySettings':
      return '策略设置';
  }
}

/**
 * 获取设置源的大写显示名称
 */
export function getSourceDisplayName(
  source: SettingSource | 'plugin' | 'built-in',
): string {
  switch (source) {
    case 'userSettings':
      return 'User';
    case 'projectSettings':
      return 'Project';
    case 'localSettings':
      return 'Local';
    case 'flagSettings':
      return 'Flag';
    case 'policySettings':
      return 'Managed';
    case 'plugin':
      return 'Plugin';
    case 'built-in':
      return 'Built-in';
  }
}

/**
 * 统一配置管理器
 * 整合所有配置子系统，提供统一入口
 */
export class UnifiedConfigManager {
  private configLoader: ConfigLoader;
  private hotReloader: HotReloader;
  private versionController: VersionController;
  private configManager: ConfigManager;
  private mergedConfig: Record<string, any>;
  private sourceConfigs: Map<SettingSource, Record<string, any>>;
  private initialized: boolean;

  constructor(options?: {
    hotReloadConfig?: Partial<HotReloadConfig>;
    maxSnapshots?: number;
  }) {
    this.configLoader = new ConfigLoader();
    this.hotReloader = new HotReloader(options?.hotReloadConfig);
    this.versionController = new VersionController(options?.maxSnapshots);
    this.configManager = new ConfigManager();
    this.mergedConfig = {};
    this.sourceConfigs = new Map();
    this.initialized = false;
  }

  /**
   * 初始化统一配置管理器
   * 加载所有配置源并合并
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const loaded = await this.configLoader.load();
      this.mergedConfig = loaded;
      this.versionController.snapshot(loaded, 'initial');
      this.initialized = true;
      logger.info('UnifiedConfigManager initialized');
    } catch (error) {
      logger.error('Failed to initialize UnifiedConfigManager:', error);
      throw error;
    }
  }

  /**
   * 获取合并后的配置
   */
  getConfig(): Record<string, any> {
    return this.mergedConfig;
  }

  /**
   * 获取指定源的配置
   */
  getSourceConfig(source: SettingSource): Record<string, any> | undefined {
    return this.sourceConfigs.get(source);
  }

  /**
   * 设置指定源的配置
   */
  setSourceConfig(source: EditableSettingSource, config: Record<string, any>): void {
    this.sourceConfigs.set(source, config);
    this.rebuildMergedConfig();
  }

  /**
   * 获取配置值
   */
  getValue<T = any>(key: string, defaultValue?: T): T {
    const keys = key.split('.');
    let current: any = this.mergedConfig;

    for (const k of keys) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return defaultValue as T;
      }
      current = current[k];
    }

    return current !== undefined ? (current as T) : (defaultValue as T);
  }

  /**
   * 设置配置值
   */
  setValue(key: string, value: any, source: EditableSettingSource = 'userSettings'): void {
    const config = this.sourceConfigs.get(source) ?? {};
    const keys = key.split('.');
    let current: any = config;

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i]!;
      if (!(k in current) || typeof current[k] !== 'object') {
        current[k] = {};
      }
      current = current[k];
    }

    current[keys[keys.length - 1]!] = value;
    this.sourceConfigs.set(source, config);
    this.rebuildMergedConfig();
  }

  /**
   * 注册热重载监听器
   */
  onReload(listener: ReloadListener): () => void {
    this.hotReloader.onReload(listener);
    return () => this.hotReloader.offReload(listener);
  }

  /**
   * 手动触发重载
   */
  async reload(): Promise<void> {
    const loaded = await this.configLoader.load();
    const previous = this.mergedConfig;
    this.mergedConfig = loaded;
    this.versionController.snapshot(loaded, 'reload');
    logger.info('Configuration reloaded');
  }

  /**
   * 创建配置快照
   */
  createSnapshot(label?: string): ConfigSnapshot {
    return this.versionController.snapshot(this.mergedConfig, label);
  }

  /**
   * 回滚到指定版本
   */
  rollback(version: number): Record<string, any> | null {
    const result = this.versionController.rollback(version);
    if (result) {
      this.mergedConfig = result.config;
      return result.config;
    }
    return null;
  }

  /**
   * 获取版本信息
   */
  getVersionInfo(): VersionInfo {
    return this.versionController.getInfo();
  }

  /**
   * 获取两个版本之间的差异
   */
  diff(v1: number, v2: number): ConfigDiff | null {
    return this.versionController.diff(v1, v2);
  }

  /**
   * 获取底层ConfigManager（兼容接口）
   */
  getConfigManager(): ConfigManager {
    return this.configManager;
  }

  /**
   * 获取底层ConfigLoader
   */
  getConfigLoader(): ConfigLoader {
    return this.configLoader;
  }

  /**
   * 获取底层HotReloader
   */
  getHotReloader(): HotReloader {
    return this.hotReloader;
  }

  /**
   * 获取底层VersionController
   */
  getVersionController(): VersionController {
    return this.versionController;
  }

  /**
   * 重建合并配置
   * 按优先级合并各源配置：userSettings < projectSettings < localSettings < flagSettings < policySettings
   */
  private rebuildMergedConfig(): void {
    let merged: Record<string, any> = {};

    for (const source of SETTING_SOURCES) {
      const config = this.sourceConfigs.get(source);
      if (config) {
        merged = this.deepMerge(merged, config);
      }
    }

    this.mergedConfig = merged;
    this.versionController.snapshot(merged, 'source_update');
  }

  /**
   * 深度合并两个配置对象
   */
  private deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
    const result = { ...target };

    for (const key of Object.keys(source)) {
      if (
        key in result &&
        typeof result[key] === 'object' &&
        result[key] !== null &&
        typeof source[key] === 'object' &&
        source[key] !== null &&
        !Array.isArray(result[key]) &&
        !Array.isArray(source[key])
      ) {
        result[key] = this.deepMerge(result[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }
}

/**
 * 全局统一配置管理器实例
 */
let globalUnifiedConfig: UnifiedConfigManager | null = null;

/**
 * 获取全局统一配置管理器
 */
export function getUnifiedConfigManager(
  options?: Parameters<typeof UnifiedConfigManager>[0],
): UnifiedConfigManager {
  if (!globalUnifiedConfig) {
    globalUnifiedConfig = new UnifiedConfigManager(options);
  }
  return globalUnifiedConfig;
}

/**
 * 重置全局统一配置管理器
 */
export function resetUnifiedConfigManager(
  options?: Parameters<typeof UnifiedConfigManager>[0],
): UnifiedConfigManager {
  globalUnifiedConfig = new UnifiedConfigManager(options);
  return globalUnifiedConfig;
}
