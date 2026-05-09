/**
 * 配置迁移器
 * 处理配置版本升级和兼容性
 */

import { GlobalConfig, createDefaultGlobalConfig } from './types.js';
import { logger } from '../utils/log.js';

/**
 * 当前迁移版本
 */
export const CURRENT_MIGRATION_VERSION = 1;

/**
 * 配置迁移器类
 */
export class ConfigMigration {
  /**
   * 迁移配置到最新版本
   * @param config 配置对象
   * @returns 迁移后的配置
   */
  static migrate(config: any): GlobalConfig {
    if (!config || typeof config !== 'object') {
      return createDefaultGlobalConfig();
    }

    const currentVersion = config.migrationVersion || 0;

    // 如果已经是最新版本，直接返回
    if (currentVersion >= CURRENT_MIGRATION_VERSION) {
      return config as GlobalConfig;
    }

    let migratedConfig = { ...config };

    // 执行迁移
    for (
      let version = currentVersion + 1;
      version <= CURRENT_MIGRATION_VERSION;
      version++
    ) {
      migratedConfig = this.runMigration(migratedConfig, version);
    }

    // 更新迁移版本
    migratedConfig.migrationVersion = CURRENT_MIGRATION_VERSION;

    logger.info(
      `配置已从版本 ${currentVersion} 迁移到版本 ${CURRENT_MIGRATION_VERSION}`
    );

    return migratedConfig as GlobalConfig;
  }

  /**
   * 执行特定版本的迁移
   * @param config 配置对象
   * @param version 目标版本
   * @returns 迁移后的配置
   */
  private static runMigration(config: any, version: number): any {
    switch (version) {
      case 1:
        return this.migrateToV1(config);
      default:
        return config;
    }
  }

  /**
   * 迁移到版本1
   * @param config 配置对象
   * @returns 迁移后的配置
   */
  private static migrateToV1(config: any): any {
    const migrated = { ...config };

    // 迁移旧的autoUpdaterStatus字段
    if (migrated.autoUpdaterStatus !== undefined) {
      switch (migrated.autoUpdaterStatus) {
        case 'migrated':
          migrated.installMethod = 'local';
          break;
        case 'installed':
          migrated.installMethod = 'native';
          break;
        case 'disabled':
          migrated.autoUpdates = false;
          break;
        case 'enabled':
        case 'no_permissions':
        case 'not_configured':
          migrated.installMethod = 'global';
          break;
      }
      delete migrated.autoUpdaterStatus;
    }

    // 确保所有新字段都有默认值
    const defaults = createDefaultGlobalConfig();
    for (const [key, value] of Object.entries(defaults)) {
      if (migrated[key] === undefined) {
        migrated[key] = value;
      }
    }

    return migrated;
  }

  /**
   * 检查配置是否需要迁移
   * @param config 配置对象
   * @returns 是否需要迁移
   */
  static needsMigration(config: any): boolean {
    if (!config || typeof config !== 'object') {
      return false;
    }

    const currentVersion = config.migrationVersion || 0;
    return currentVersion < CURRENT_MIGRATION_VERSION;
  }

  /**
   * 获取配置版本
   * @param config 配置对象
   * @returns 配置版本
   */
  static getVersion(config: any): number {
    if (!config || typeof config !== 'object') {
      return 0;
    }
    return config.migrationVersion || 0;
  }
}
