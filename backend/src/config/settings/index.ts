/**
 * 多源设置管理
 * 基于CC源码 cc_code/backend/utils/settings/settings.ts 的多源合并逻辑
 * 按优先级合并各源配置：userSettings < projectSettings < localSettings < flagSettings < policySettings
 *
 * 本模块委托给 UnifiedConfigManager 实现，避免多源设置的重复实现。
 * 新代码应直接使用 @modules/config 中的 getUnifiedConfigManager()。
 */

import {
  getUnifiedConfigManager,
  type SettingSource,
  type EditableSettingSource,
} from '../UnifiedConfigManager.js';

/**
 * 多源设置管理器
 * 委托给 UnifiedConfigManager 实现，保持向后兼容
 */
export class MultiSourceSettingsManager {
  constructor(_options?: { cacheTtl?: number }) {}

  /**
   * 设置命令行标志配置
   */
  setFlagSettings(flags: Record<string, unknown>): void {
    getUnifiedConfigManager().setFlagSettings(flags);
  }

  /**
   * 获取合并后的设置
   */
  getMergedSettings(): Record<string, unknown> {
    const ucm = getUnifiedConfigManager();
    ucm.loadSyncSources();
    return ucm.getConfig();
  }

  /**
   * 获取指定源的设置
   */
  getSourceSettings(source: SettingSource): Record<string, unknown> {
    return getUnifiedConfigManager().getSourceConfig(source) ?? {};
  }

  /**
   * 获取设置值及其来源
   */
  getSettingWithSource(
    key: string
  ): { value: unknown; source: SettingSource } | undefined {
    return getUnifiedConfigManager().getSettingWithSource(key);
  }

  /**
   * 获取设置值
   */
  getValue<T = unknown>(key: string, defaultValue?: T): T {
    return getUnifiedConfigManager().getValue(key, defaultValue);
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
    return getUnifiedConfigManager().getSourcesStatus();
  }

  /**
   * 刷新缓存
   */
  refreshCache(): void {
    getUnifiedConfigManager().refreshSyncSources();
  }

  /**
   * 使缓存失效
   */
  invalidateCache(): void {
    getUnifiedConfigManager().invalidateCache();
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
