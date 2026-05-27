/**
 * 治理配置管理服务
 * 提供配置持久化、热更新和版本管理功能
 * 参考CC源码: cc_code/backend/utils/settings/settings.ts
 */

import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { GovernanceConfig } from '../types/GovernanceTypes';
import { createDefaultGovernanceConfig } from '../types/GovernanceTypes';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 配置版本
 */
export interface ConfigVersion {
  version: number;
  timestamp: number;
  config: GovernanceConfig;
  reason?: string;
}

/**
 * 配置管理事件
 */
export interface ConfigEvent {
  type: 'configUpdated' | 'configRolledBack' | 'configLoaded';
  version?: number;
  timestamp: number;
}

/**
 * 治理配置管理服务类
 */
export class GovernanceConfigManager extends EventEmitter {
  private static instance: GovernanceConfigManager;
  private configPath: string;
  private versionsPath: string;
  private currentConfig: GovernanceConfig;
  private versions: ConfigVersion[] = [];
  private maxVersions: number = 50;
  private currentVersion: number = 0;

  private constructor() {
    super();
    this.configPath = this.getConfigPath();
    this.versionsPath = this.getVersionsPath();
    this.currentConfig = this.loadConfig();
    this.versions = this.loadVersions();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): GovernanceConfigManager {
    if (!GovernanceConfigManager.instance) {
      GovernanceConfigManager.instance = new GovernanceConfigManager();
    }
    return GovernanceConfigManager.instance;
  }

  /**
   * 获取治理配置存储根目录（app/data/governance/）
   */
  private getGovernanceDir(): string {
    const projectRoot = process.env.PYAPP_PROJECT_DIR || process.cwd();
    return join(projectRoot, 'backend', 'data', 'governance');
  }

  /**
   * 获取配置文件路径
   */
  private getConfigPath(): string {
    const governanceDir = this.getGovernanceDir();

    if (!existsSync(governanceDir)) {
      mkdirSync(governanceDir, { recursive: true });
    }

    return join(governanceDir, 'governance.json');
  }

  /**
   * 获取版本文件路径
   */
  private getVersionsPath(): string {
    const governanceDir = this.getGovernanceDir();
    const versionsDir = join(governanceDir, 'versions');

    if (!existsSync(versionsDir)) {
      mkdirSync(versionsDir, { recursive: true });
    }

    return join(versionsDir, 'governance_versions.json');
  }

  /**
   * 加载配置
   */
  private loadConfig(): GovernanceConfig {
    if (existsSync(this.configPath)) {
      try {
        const content = readFileSync(this.configPath, 'utf-8');
        const config = JSON.parse(content);
        return {
          ...createDefaultGovernanceConfig(),
          ...config,
        };
      } catch (error) {
        logger.error('Failed to load governance config:', { error });
        return createDefaultGovernanceConfig();
      }
    }
    return createDefaultGovernanceConfig();
  }

  /**
   * 加载版本历史
   */
  private loadVersions(): ConfigVersion[] {
    if (existsSync(this.versionsPath)) {
      try {
        const content = readFileSync(this.versionsPath, 'utf-8');
        const versions = JSON.parse(content);
        return Array.isArray(versions) ? versions : [];
      } catch (error) {
        logger.error('Failed to load governance config versions:', { error });
        return [];
      }
    }
    return [];
  }

  /**
   * 保存配置
   */
  private saveConfig(): void {
    try {
      writeFileSync(
        this.configPath,
        JSON.stringify(this.currentConfig, null, 2) + '\n'
      );
    } catch (error) {
      logger.error('Failed to save governance config:', { error });
    }
  }

  /**
   * 保存版本历史
   */
  private saveVersions(): void {
    try {
      writeFileSync(
        this.versionsPath,
        JSON.stringify(this.versions, null, 2) + '\n'
      );
    } catch (error) {
      logger.error('Failed to save governance config versions:', { error });
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): GovernanceConfig {
    return { ...this.currentConfig };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<GovernanceConfig>, reason?: string): void {
    const newConfig = { ...this.currentConfig, ...config };

    this.currentVersion++;
    const version: ConfigVersion = {
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
  rollbackToVersion(versionNumber: number): boolean {
    const version = this.versions.find((v) => v.version === versionNumber);

    if (!version) {
      return false;
    }

    this.currentConfig = { ...version.config };
    this.currentVersion++;

    const rollbackVersion: ConfigVersion = {
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
  getVersions(): ConfigVersion[] {
    return [...this.versions];
  }

  /**
   * 获取特定版本
   */
  getVersion(versionNumber: number): ConfigVersion | undefined {
    return this.versions.find((v) => v.version === versionNumber);
  }

  /**
   * 获取当前版本号
   */
  getCurrentVersion(): number {
    return this.currentVersion;
  }

  /**
   * 重置配置为默认值
   */
  resetToDefault(reason?: string): void {
    this.updateConfig(
      createDefaultGovernanceConfig(),
      reason || 'Reset to default'
    );
  }

  /**
   * 导入配置
   */
  importConfig(config: GovernanceConfig, reason?: string): void {
    this.updateConfig(config, reason || 'Imported config');
  }

  /**
   * 导出配置
   */
  exportConfig(): GovernanceConfig {
    return { ...this.currentConfig };
  }

  /**
   * 验证配置
   */
  validateConfig(config: GovernanceConfig): boolean {
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
   * 重置服务
   */
  reset(): void {
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
export const governanceConfigManager = GovernanceConfigManager.getInstance();
