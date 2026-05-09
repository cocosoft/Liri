/**
 * 治理配置管理服务
 * 提供配置持久化、热更新和版本管理功能
 * 参考CC源码: cc_code/backend/utils/settings/settings.ts
 */

import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createDefaultGovernanceConfig } from '../types/GovernanceTypes.js';

/**
 * 治理配置管理服务类
 */
class GovernanceConfigManager extends EventEmitter {
  constructor() {
    super();
    this.configPath = this.getConfigPath();
    this.versionsPath = this.getVersionsPath();
    this.currentConfig = this.loadConfig();
    this.versions = this.loadVersions();
    this.maxVersions = 50;
    this.currentVersion = 0;
    this.initialize();
  }

  /**
   * 获取单例实例
   */
  static getInstance() {
    if (!GovernanceConfigManager.instance) {
      GovernanceConfigManager.instance = new GovernanceConfigManager();
    }
    return GovernanceConfigManager.instance;
  }

  /**
   * 初始化
   */
  initialize() {
    // 确保目录存在
    this.ensureDirectories();
    // 加载配置和版本历史
    this.currentConfig = this.loadConfig();
    this.versions = this.loadVersions();
  }

  /**
   * 确保目录存在
   */
  ensureDirectories() {
    const configDir = dirname(this.configPath);
    const versionsDir = dirname(this.versionsPath);

    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    if (!existsSync(versionsDir)) {
      mkdirSync(versionsDir, { recursive: true });
    }
  }

  /**
   * 获取配置文件路径
   */
  getConfigPath() {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const configDir = join(__dirname, '..', '..', '..', 'config');
    return join(configDir, 'governance.json');
  }

  /**
   * 获取版本文件路径
   */
  getVersionsPath() {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const versionsDir = join(__dirname, '..', '..', '..', 'config', 'versions');
    return join(versionsDir, 'governance_versions.json');
  }

  /**
   * 加载配置
   */
  loadConfig() {
    if (existsSync(this.configPath)) {
      try {
        const content = readFileSync(this.configPath, 'utf-8');
        const config = JSON.parse(content);
        return {
          ...createDefaultGovernanceConfig(),
          ...config,
        };
      } catch (error) {
        console.error('Failed to load governance config:', error);
        return createDefaultGovernanceConfig();
      }
    }
    return createDefaultGovernanceConfig();
  }

  /**
   * 加载版本历史
   */
  loadVersions() {
    if (existsSync(this.versionsPath)) {
      try {
        const content = readFileSync(this.versionsPath, 'utf-8');
        const versions = JSON.parse(content);
        return Array.isArray(versions) ? versions : [];
      } catch (error) {
        console.error('Failed to load governance config versions:', error);
        return [];
      }
    }
    return [];
  }

  /**
   * 保存配置
   */
  saveConfig() {
    try {
      writeFileSync(
        this.configPath,
        JSON.stringify(this.currentConfig, null, 2) + '\n'
      );
    } catch (error) {
      console.error('Failed to save governance config:', error);
    }
  }

  /**
   * 保存版本历史
   */
  saveVersions() {
    try {
      writeFileSync(
        this.versionsPath,
        JSON.stringify(this.versions, null, 2) + '\n'
      );
    } catch (error) {
      console.error('Failed to save governance config versions:', error);
    }
  }

  /**
   * 获取当前配置
   */
  getConfig() {
    return { ...this.currentConfig };
  }

  /**
   * 更新配置
   */
  updateConfig(config, reason) {
    const newConfig = { ...this.currentConfig, ...config };

    this.currentVersion++;
    const version = {
      version: this.currentVersion,
      timestamp: Date.now(),
      config: { ...newConfig },
      reason,
    };

    this.versions.push(version);

    if (this.versions.length > this.maxVersions) {
      this.versions.shift();
    }

    this.currentConfig = newConfig;
    this.saveConfig();
    this.saveVersions();

    this.emit('configEvent', {
      type: 'configUpdated',
      version: this.currentVersion,
      timestamp: Date.now(),
    });
  }

  /**
   * 回滚配置
   */
  rollbackToVersion(versionNumber) {
    const version = this.versions.find((v) => v.version === versionNumber);

    if (!version) {
      return false;
    }

    this.currentConfig = { ...version.config };
    this.currentVersion++;

    const rollbackVersion = {
      version: this.currentVersion,
      timestamp: Date.now(),
      config: { ...this.currentConfig },
      reason: `Rolled back to version ${versionNumber}`,
    };

    this.versions.push(rollbackVersion);

    if (this.versions.length > this.maxVersions) {
      this.versions.shift();
    }

    this.saveConfig();
    this.saveVersions();

    this.emit('configEvent', {
      type: 'configRolledBack',
      version: this.currentVersion,
      timestamp: Date.now(),
    });

    return true;
  }

  /**
   * 获取版本历史
   */
  getVersions() {
    return [...this.versions];
  }

  /**
   * 获取特定版本
   */
  getVersion(versionNumber) {
    return this.versions.find((v) => v.version === versionNumber);
  }

  /**
   * 获取当前版本号
   */
  getCurrentVersion() {
    return this.currentVersion;
  }

  /**
   * 重置配置为默认值
   */
  resetToDefault(reason) {
    this.updateConfig(
      createDefaultGovernanceConfig(),
      reason || 'Reset to default'
    );
  }

  /**
   * 导入配置
   */
  importConfig(config, reason) {
    this.updateConfig(config, reason || 'Imported config');
  }

  /**
   * 导出配置
   */
  exportConfig() {
    return { ...this.currentConfig };
  }

  /**
   * 验证配置
   */
  validateConfig(config) {
    try {
      const defaultConfig = createDefaultGovernanceConfig();

      // 检查必要的字段
      const requiredFields = Object.keys(defaultConfig);
      for (const field of requiredFields) {
        if (!(field in config)) {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 应用配置热更新
   */
  applyHotUpdate() {
    const newConfig = this.loadConfig();
    if (JSON.stringify(newConfig) !== JSON.stringify(this.currentConfig)) {
      this.currentConfig = newConfig;
      this.emit('configEvent', {
        type: 'configLoaded',
        timestamp: Date.now(),
      });
      return true;
    }
    return false;
  }

  /**
   * 重置服务
   */
  reset() {
    this.currentConfig = createDefaultGovernanceConfig();
    this.versions = [];
    this.currentVersion = 0;
    this.saveConfig();
    this.saveVersions();
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
GovernanceConfigManager.instance = new GovernanceConfigManager();

export { GovernanceConfigManager };
export const governanceConfigManager = GovernanceConfigManager.getInstance();
