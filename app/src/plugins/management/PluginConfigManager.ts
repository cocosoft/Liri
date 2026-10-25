/**
 * 负责插件的配置管理、验证、存储和更新
 */

import { EventEmitter } from 'events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolvePluginsConfigDir } from '@openliri/kernel';
import { PluginConfig } from '../types/PluginTypes';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('plugins:management:pluginConfigManager');

/*
 * 说明（2026-10-26，CS01 / 实现唯一性）：本类**不持有** config schema。
 * 插件配置的 schema 与校验唯一实现在 `plugins/utils/pluginConfigSchema.ts`
 * （`validatePluginConfig` / `mergeWithDefaults`，消费方 `commands/plugin-settings`）。
 * 此前这里的 `ConfigSchema` / `setSchema` / `getSchema` / `validateConfig` 全套**无任何调用者**
 * （生产与测试均为 0），却让 `setConfig` 看似"校验过"——实际 `schemas` 恒空、恒返回 valid，
 * 只多带一条无人读取的 warning。已删除，行为零变更（见台账 SAFETY-... 系列之外的
 * `PLUGIN-CONFIG-SCHEMA-HOLLOW`）。
 */
/**
 * 插件配置管理器
 */
export class PluginConfigManager extends EventEmitter {
  private configs: Map<string, PluginConfig> = new Map();
  /** 2026-08-06 新增：配置持久化文件（~/.pyapp/plugins/config/config.json） */
  private configFilePath = join(resolvePluginsConfigDir(), 'config.json');

  /**
   * 加载持久化配置（插件系统初始化时调用）
   * 2026-08-06 新增：配置落盘，重启不丢失
   */
  loadPersistedConfigs(): void {
    try {
      if (!existsSync(this.configFilePath)) return;
      const raw = readFileSync(this.configFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, PluginConfig>;
      for (const [pluginId, config] of Object.entries(parsed)) {
        this.configs.set(pluginId, config);
      }
      logger.info(
        `Loaded persisted plugin configs: ${Object.keys(parsed).length}`
      );
    } catch (error) {
      logger.error('Failed to load persisted plugin configs', { error });
    }
  }

  /**
   * 持久化全部配置（setConfig 后调用）
   * 2026-08-06 新增：原子写盘
   */
  private persistConfigs(): void {
    try {
      const dir = resolvePluginsConfigDir();
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const data = Object.fromEntries(this.configs.entries());
      writeFileSync(
        this.configFilePath,
        JSON.stringify(data, null, 2),
        'utf-8'
      );
    } catch (error) {
      logger.error('Failed to persist plugin configs', { error });
    }
  }

  /**
   * 设置插件配置
   */
  setConfig(pluginId: string, config: PluginConfig): void {
    // 合并配置
    const currentConfig = this.configs.get(pluginId) || {};
    const mergedConfig = { ...currentConfig, ...config };

    this.configs.set(pluginId, mergedConfig);

    // 2026-08-06 新增：配置落盘持久化
    this.persistConfigs();

    this.emit('configUpdated', { pluginId, config: mergedConfig });

    logger.info(`✅ Config updated for plugin: ${pluginId}`);
  }

  /**
   * 获取插件配置
   */
  getConfig(pluginId: string): PluginConfig {
    // 只返回**已存储**的值：本类不做 schema 默认值合并（唯一实现在 `pluginConfigSchema.ts`）
    return { ...this.configs.get(pluginId) };
  }

  /**
   * 获取配置值
   */
  getConfigValue<T>(pluginId: string, key: string, defaultValue?: T): T {
    const config = this.getConfig(pluginId);

    if (config[key] !== undefined) {
      return config[key] as T;
    }

    return defaultValue as T;
  }

  /**
   * 设置配置值
   */
  setConfigValue(pluginId: string, key: string, value: unknown): void {
    const currentConfig = this.getConfig(pluginId);
    const newConfig = { ...currentConfig, [key]: value };

    this.setConfig(pluginId, newConfig);
  }

  /**
   * 重置插件配置
   */
  resetConfig(pluginId: string): void {
    this.configs.delete(pluginId);

    // 2026-08-06 修复：重置后同步落盘，避免磁盘残留已删除配置
    this.persistConfigs();

    this.emit('configReset', { pluginId });

    logger.info(`✅ Config reset for plugin: ${pluginId}`);
  }

  /**
   * 获取所有插件配置
   */
  getAllConfigs(): Map<string, PluginConfig> {
    return new Map(this.configs);
  }

  /**
   * 导出配置
   */
  exportConfigs(): Record<string, PluginConfig> {
    const result: Record<string, PluginConfig> = {};

    for (const [pluginId, config] of this.configs.entries()) {
      result[pluginId] = config;
    }

    return result;
  }

  /**
   * 导入配置
   */
  importConfigs(configs: Record<string, PluginConfig>): void {
    for (const [pluginId, config] of Object.entries(configs)) {
      this.setConfig(pluginId, config);
    }
  }

  /**
   * 清理配置管理器
   */
  clear(): void {
    this.configs.clear();

    logger.info('✅ Plugin config manager cleared');
  }
}

export default PluginConfigManager;
