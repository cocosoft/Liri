/**
 * 多源设置管理
 * 基于CC源码 cc_code/backend/utils/settings/settings.ts 的多源合并逻辑
 * 按优先级合并各源配置：userSettings < projectSettings < localSettings < flagSettings < policySettings
 */

import { logger } from '@modules/utils/log.js';
import { loadUserSettings } from './userSettings.js';
import { loadProjectSettings } from './projectSettings.js';
import { loadLocalSettings } from './localSettings.js';
import {
  loadPolicySettings,
  isPolicySettingsAvailable,
} from './policySettings.js';
import {
  SETTING_SOURCES,
  type SettingSource,
  type EditableSettingSource,
  getSettingSourceName,
} from '../UnifiedConfigManager.js';

/**
 * 设置缓存
 */
interface SettingsCache {
  merged: Record<string, any>;
  sources: Map<SettingSource, Record<string, any>>;
  lastRefresh: number;
}

/**
 * 多源设置管理器
 * 负责从多个设置源加载、合并和管理配置
 */
export class MultiSourceSettingsManager {
  private cache: SettingsCache;
  private cacheTtl: number;
  private flagSettings: Record<string, any>;

  constructor(options?: { cacheTtl?: number }) {
    this.cacheTtl = options?.cacheTtl ?? 5000;
    this.flagSettings = {};
    this.cache = {
      merged: {},
      sources: new Map(),
      lastRefresh: 0,
    };
  }

  /**
   * 设置命令行标志配置
   */
  setFlagSettings(flags: Record<string, any>): void {
    this.flagSettings = flags;
    this.invalidateCache();
  }

  /**
   * 获取合并后的设置
   * 按优先级合并：userSettings < projectSettings < localSettings < flagSettings < policySettings
   */
  getMergedSettings(): Record<string, any> {
    if (this.isCacheValid()) {
      return this.cache.merged;
    }

    this.refreshCache();
    return this.cache.merged;
  }

  /**
   * 获取指定源的设置
   */
  getSourceSettings(source: SettingSource): Record<string, any> {
    if (!this.isCacheValid()) {
      this.refreshCache();
    }
    return this.cache.sources.get(source) ?? {};
  }

  /**
   * 获取设置值
   * 返回值和来源
   */
  getSettingWithSource(
    key: string
  ): { value: any; source: SettingSource } | undefined {
    const sources = [...SETTING_SOURCES].reverse();

    for (const source of sources) {
      const config = this.getSourceSettings(source);
      const value = getNestedValue(config, key);
      if (value !== undefined) {
        return { value, source };
      }
    }

    return undefined;
  }

  /**
   * 获取设置值
   */
  getValue<T = any>(key: string, defaultValue?: T): T {
    const result = this.getSettingWithSource(key);
    return result !== undefined ? (result.value as T) : (defaultValue as T);
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
    if (!this.isCacheValid()) {
      this.refreshCache();
    }

    return SETTING_SOURCES.map((source) => {
      const config = this.cache.sources.get(source) ?? {};
      return {
        source,
        name: getSettingSourceName(source),
        available: Object.keys(config).length > 0,
        settingCount: Object.keys(config).length,
      };
    });
  }

  /**
   * 刷新缓存
   */
  refreshCache(): void {
    const sources = new Map<SettingSource, Record<string, any>>();

    sources.set('userSettings', loadUserSettings());
    sources.set('projectSettings', loadProjectSettings());
    sources.set('localSettings', loadLocalSettings());
    sources.set('flagSettings', this.flagSettings);
    sources.set(
      'policySettings',
      isPolicySettingsAvailable() ? loadPolicySettings() : {}
    );

    let merged: Record<string, any> = {};
    for (const source of SETTING_SOURCES) {
      const config = sources.get(source) ?? {};
      merged = deepMerge(merged, config);
    }

    this.cache = {
      merged,
      sources,
      lastRefresh: Date.now(),
    };
  }

  /**
   * 使缓存失效
   */
  invalidateCache(): void {
    this.cache.lastRefresh = 0;
  }

  /**
   * 检查缓存是否有效
   */
  private isCacheValid(): boolean {
    return (
      this.cache.lastRefresh > 0 &&
      Date.now() - this.cache.lastRefresh < this.cacheTtl
    );
  }
}

/**
 * 全局多源设置管理器实例
 */
let globalSettingsManager: MultiSourceSettingsManager | null = null;

/**
 * 获取全局多源设置管理器
 */
export function getMultiSourceSettingsManager(
  options?: ConstructorParameters<typeof MultiSourceSettingsManager>[0]
): MultiSourceSettingsManager {
  if (!globalSettingsManager) {
    globalSettingsManager = new MultiSourceSettingsManager(options);
  }
  return globalSettingsManager;
}

/**
 * 获取嵌套值
 */
function getNestedValue(obj: Record<string, any>, key: string): any {
  const keys = key.split('.');
  let current: any = obj;

  for (const k of keys) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== 'object'
    ) {
      return undefined;
    }
    current = current[k];
  }

  return current;
}

/**
 * 深度合并对象
 */
function deepMerge(
  target: Record<string, any>,
  source: Record<string, any>
): Record<string, any> {
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
      result[key] = deepMerge(result[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}
