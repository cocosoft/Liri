/**
 * 统一配置管理器
 * 整合 ConfigLoader、HotReloader、VersionController 及多源设置管理
 * 提供统一的配置访问入口，支持多源设置管理
 *
 * 多源合并功能委托给 ConfigManager 实现，避免重复。
 * 本层负责编排 ConfigLoader、HotReloader、VersionController 等子系统。
 *
 * @see ConfigManager.loadSyncSources / getMergedConfig / getSettingWithSource
 */

import { getLogger } from '../monitoring/logs/Logger.js';
import { handleError } from '@modules/error';
const logger = getLogger('config:UnifiedConfigManager');
import { globalEventBus, SystemEvents } from '@modules/core/events/EventBus.js';
import {
  ConfigLoader,
  type ConfigSource,
  type ConfigLoadResult,
} from './loader/ConfigLoader.js';
import {
  HotReloader,
  type ReloadEvent,
  type ReloadListener,
  type HotReloadConfig,
} from './hotreload/HotReloader.js';
import {
  VersionController,
  type ConfigSnapshot,
  type ConfigDiff,
  type VersionInfo,
} from './version/VersionController.js';
import { configManager } from './ConfigManager.js';
import {
  saveUserSettings,
  updateUserSettings,
  deleteUserSetting,
} from './settings/userSettings.js';
import {
  saveProjectSettings,
  updateProjectSettings,
} from './settings/projectSettings.js';
import {
  saveLocalSettings,
  updateLocalSettings,
} from './settings/localSettings.js';

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
  source: SettingSource | 'plugin' | 'built-in'
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
  private mergedConfig: Record<string, unknown>;
  private initialized: boolean;
  private syncSourcesLoaded: boolean;
  private cacheTtl: number;
  private cacheLastRefresh: number;

  constructor(options?: {
    hotReloadConfig?: Partial<HotReloadConfig>;
    maxSnapshots?: number;
    cacheTtl?: number;
  }) {
    this.configLoader = new ConfigLoader();
    this.hotReloader = new HotReloader(options?.hotReloadConfig);
    this.versionController = new VersionController(options?.maxSnapshots);
    this.mergedConfig = {};
    this.initialized = false;
    this.syncSourcesLoaded = false;
    this.cacheTtl = options?.cacheTtl ?? 5000;
    this.cacheLastRefresh = 0;
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
      void handleError(error, {
        module: 'config:unified',
        action: '统一配置管理器初始化失败',
      });
      throw error;
    }
  }

  /**
   * 获取合并后的配置
   */
  getConfig(): Record<string, unknown> {
    return this.mergedConfig;
  }

  /**
   * 获取指定源的配置
   */
  getSourceConfig(source: SettingSource): Record<string, unknown> | undefined {
    return configManager.getSourceConfig(source);
  }

  /**
   * 设置指定源的配置
   */
  setSourceConfig(
    source: EditableSettingSource,
    config: Record<string, unknown>
  ): void {
    configManager.setSourceConfig(source, config);
  }

  /**
   * 获取配置值
   */
  getValue<T = unknown>(key: string, defaultValue?: T): T {
    const keys = key.split('.');
    let current: Record<string, unknown> = this.mergedConfig as Record<
      string,
      unknown
    >;

    for (const k of keys) {
      if (
        current === null ||
        current === undefined ||
        typeof current !== 'object'
      ) {
        return defaultValue as T;
      }
      current = current[k] as Record<string, unknown>;
    }

    return current !== undefined
      ? (current as unknown as T)
      : (defaultValue as T);
  }

  /**
   * 设置配置值
   */
  setValue(
    key: string,
    value: unknown,
    source: EditableSettingSource = 'userSettings'
  ): void {
    const config = this.getSourceConfig(source) ?? {};
    const root: Record<string, unknown> = { ...config };
    const keys = key.split('.');
    let current = root;

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i]!;
      if (!(k in current) || typeof current[k] !== 'object') {
        current[k] = {};
      }
      current = current[k] as Record<string, unknown>;
    }

    current[keys[keys.length - 1]!] = value;
    configManager.setSourceConfig(source, root);
  }

  /**
   * 注册热重载监听器
   */
  onReload(listener: ReloadListener): () => void {
    this.hotReloader.onReload(listener);
    return () =>
      (
        this.hotReloader as unknown as {
          offReload: (listener: ReloadListener) => void;
        }
      ).offReload(listener);
  }

  /**
   * 手动触发重载
   */
  async reload(): Promise<void> {
    const loaded = await this.configLoader.load();
    const previous = this.mergedConfig;
    const changedKeys = this.detectChangedKeys(previous, loaded);

    this.mergedConfig = loaded;
    this.versionController.snapshot(loaded, 'reload');

    if (changedKeys.length > 0) {
      globalEventBus.publish(SystemEvents.CONFIG_CHANGED, {
        changedKeys,
        timestamp: Date.now(),
        source: 'manual',
      });
    }

    logger.info('Configuration reloaded');
  }

  /**
   * 检测两个配置对象之间的差异键
   */
  private detectChangedKeys(
    previous: Record<string, unknown>,
    current: Record<string, unknown>
  ): string[] {
    const changedKeys: string[] = [];
    const allKeys = new Set([
      ...Object.keys(previous),
      ...Object.keys(current),
    ]);

    for (const key of allKeys) {
      if (previous[key] !== current[key]) {
        changedKeys.push(key);
      }
    }

    return changedKeys;
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
  rollback(version: number): Record<string, unknown> | null {
    const result = this.versionController.rollback(version);
    if (result) {
      this.mergedConfig = result.config;
      globalEventBus.publish(SystemEvents.CONFIG_RESET, {
        version,
        timestamp: Date.now(),
        source: 'rollback',
      });
      return result.config;
    }
    return null;
  }

  /**
   * 获取版本信息
   */
  getVersionInfo(): VersionInfo {
    return this.versionController.getVersionInfo();
  }

  /**
   * 获取两个版本之间的差异
   */
  diff(v1: number, v2: number): ConfigDiff | null {
    return this.versionController.compareVersions(v1, v2);
  }

  /**
   * 获取底层ConfigManager（兼容接口）
   */
  getConfigManager() {
    return configManager;
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
   * 设置命令行标志配置
   */
  setFlagSettings(flags: Record<string, unknown>): void {
    configManager.setSourceConfig('flagSettings', flags);
  }

  /**
   * 加载同步设置源
   * 从各设置文件同步加载：userSettings < projectSettings < localSettings < flagSettings < policySettings
   */
  loadSyncSources(): void {
    configManager.loadSyncSources();
    this.syncSourcesLoaded = true;
    this.cacheLastRefresh = Date.now();
  }

  /**
   * 刷新同步设置源
   */
  refreshSyncSources(): void {
    configManager.refreshSyncSources();
    this.cacheLastRefresh = Date.now();
  }

  /**
   * 获取设置值及其来源
   */
  getSettingWithSource(
    key: string
  ): { value: unknown; source: SettingSource } | undefined {
    const result = configManager.getSettingWithSource(key);
    if (result) {
      return { value: result.value, source: result.source as SettingSource };
    }
    return undefined;
  }

  /**
   * 获取所有设置源的状态
   */
  getSourcesStatus(): Array<{
    source: SettingSource;
    name: string;
    available: boolean;
    settingCount: number;
  }> {
    return [...(SETTING_SOURCES as readonly SettingSource[])].map((source) => {
      const config = this.getSourceConfig(source) ?? {};
      return {
        source,
        name: getSettingSourceName(source),
        available: Object.keys(config).length > 0,
        settingCount: Object.keys(config).length,
      };
    });
  }

  /**
   * 使缓存失效
   */
  invalidateCache(): void {
    this.cacheLastRefresh = 0;
  }

  /**
   * 重建合并配置
   * 按优先级合并各源配置：userSettings < projectSettings < localSettings < flagSettings < policySettings
   */
  rebuildMergedConfig(): void {
    const previous = this.mergedConfig;
    configManager.loadSyncSources();
    this.mergedConfig = configManager.getMergedConfig();
    this.versionController.snapshot(this.mergedConfig, 'source_update');

    const changedKeys = this.detectChangedKeys(previous, this.mergedConfig);
    if (changedKeys.length > 0) {
      globalEventBus.publish(SystemEvents.CONFIG_CHANGED, {
        changedKeys,
        timestamp: Date.now(),
        source: 'rebuild',
      });
    }
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
  options?: ConstructorParameters<typeof UnifiedConfigManager>[0]
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
  options?: ConstructorParameters<typeof UnifiedConfigManager>[0]
): UnifiedConfigManager {
  globalUnifiedConfig = new UnifiedConfigManager(options);
  return globalUnifiedConfig;
}
