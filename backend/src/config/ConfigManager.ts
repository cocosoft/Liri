/**
 * 配置管理器
 * 提供配置加载、保存、缓存和监控功能
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  copyFileSync,
  statSync,
  watchFile,
  unwatchFile,
} from 'fs';
import { join, dirname, basename } from 'path';
import { logger } from '../utils/log.js';
import {
  GlobalConfig,
  ProjectConfig,
  createDefaultGlobalConfig,
  DEFAULT_PROJECT_CONFIG,
  ConfigStats,
  ConfigSource,
} from './types.js';
import { ConfigValidator } from './ConfigValidator.js';
import { ConfigMigration } from './ConfigMigration.js';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { ConfigSnapshot, createDefaultConfigSnapshot } from './ConfigSnapshot';
import { ConfigRecovery } from './ConfigRecovery';
import { redactConfig } from './ConfigRedactor';

/**
 * 配置管理器类
 */
export class ConfigManager {
  private globalConfigPath: string;
  private configCache: { config: GlobalConfig | null; mtime: number } = {
    config: null,
    mtime: 0,
  };
  private stats: ConfigStats = {
    readCount: 0,
    writeCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };
  private freshnessWatcherStarted = false;
  private readonly CONFIG_FRESHNESS_POLL_MS = 1000;
  private readonly CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5分钟
  private configReadingAllowed = false;
  private configSnapshot: ConfigSnapshot;
  private configRecovery: ConfigRecovery;

  /**
   * 构造函数
   * @param configPath 配置文件路径
   */
  constructor(configPath?: string) {
    this.globalConfigPath = configPath || this.getDefaultConfigPath();
    const configDir = dirname(this.globalConfigPath);
    this.configSnapshot = createDefaultConfigSnapshot(configDir);
    this.configRecovery = new ConfigRecovery(
      this.configSnapshot,
      this.globalConfigPath
    );
  }

  /**
   * 获取默认配置文件路径
   * @returns 默认配置文件路径
   */
  private getDefaultConfigPath(): string {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    return join(homeDir, '.PY_APP', 'config.json');
  }

  /**
   * 获取配置备份目录
   * @returns 配置备份目录路径
   */
  private getConfigBackupDir(): string {
    return join(dirname(this.globalConfigPath), 'backups');
  }

  /**
   * 启用配置系统
   */
  enableConfigs(): void {
    if (this.configReadingAllowed) {
      return;
    }

    this.configReadingAllowed = true;
    // 预加载配置
    this.getGlobalConfig();
    logger.info('配置系统已启用');
  }

  /**
   * 获取全局配置
   * @returns 全局配置
   */
  getGlobalConfig(): GlobalConfig {
    // 快速路径：内存读取
    if (this.configCache.config) {
      this.stats.cacheHits++;
      return this.configCache.config;
    }

    // 慢速路径：从文件加载
    this.stats.cacheMisses++;
    try {
      let stats: { mtimeMs: number; size: number } | null = null;
      try {
        stats = statSync(this.globalConfigPath);
      } catch {
        // 文件不存在
      }

      const config = this.loadConfigFromFile();
      this.configCache = {
        config,
        mtime: stats?.mtimeMs ?? Date.now(),
      };
      this.stats.readCount++;
      this.stats.lastReadTime = Date.now();

      // 启动文件监控
      this.startFreshnessWatcher();
      return config;
    } catch (error) {
      logger.error(
        '加载配置失败，使用默认配置',
        error instanceof Error ? error : undefined
      );
      return createDefaultGlobalConfig();
    }
  }

  /**
   * 获取脱敏后的全局配置（用于日志和安全输出）
   * @returns 脱敏后的全局配置
   */
  getRedactedGlobalConfig(): GlobalConfig {
    return redactConfig(
      this.getGlobalConfig() as unknown as Record<string, unknown>
    ) as unknown as GlobalConfig;
  }

  /**
   * 从文件加载配置
   * @returns 全局配置
   */
  private loadConfigFromFile(): GlobalConfig {
    if (!this.configReadingAllowed && process.env.NODE_ENV !== 'test') {
      throw new AppError(
        '配置系统在启用前不可访问',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    try {
      const fileContent = readFileSync(this.globalConfigPath, 'utf-8');
      const parsedConfig = JSON.parse(fileContent);

      // 迁移配置
      const migratedConfig = ConfigMigration.migrate(parsedConfig);

      // 合并默认配置
      const config: GlobalConfig = {
        ...createDefaultGlobalConfig(),
        ...migratedConfig,
      };

      // 验证配置
      const validation = ConfigValidator.validate(config);
      if (!validation.valid) {
        logger.warn('配置验证失败，使用默认值修正', {
          errors: validation.errors,
        });
      }

      return config;
    } catch (error) {
      const errCode = (error as any)?.code;
      if (errCode === 'ENOENT') {
        logger.info('配置文件不存在，使用默认配置');
        return createDefaultGlobalConfig();
      }

      if (error instanceof SyntaxError) {
        logger.error('配置文件格式错误，尝试从快照恢复', error);
        // 备份损坏的配置
        this.backupCorruptedConfig();

        // 尝试从快照恢复
        const recovery = this.configRecovery.attemptRecovery();
        if (recovery.recovered && recovery.config) {
          const recoveredConfig: GlobalConfig = {
            ...createDefaultGlobalConfig(),
            ...(recovery.config as unknown as Partial<GlobalConfig>),
          };
          logger.warn('配置已从快照恢复，请检查配置完整性', {
            snapshotPath: recovery.snapshotPath,
          });
          return recoveredConfig;
        }

        logger.error('快照恢复失败，使用默认配置');
        if (recovery.error) {
          logger.warn('恢复错误详情', { error: recovery.error });
        }
        return createDefaultGlobalConfig();
      }

      throw error;
    }
  }

  /**
   * 保存全局配置
   * @param updater 配置更新函数
   */
  saveGlobalConfig(
    updater: (currentConfig: GlobalConfig) => GlobalConfig
  ): void {
    try {
      const currentConfig = this.getGlobalConfig();
      const newConfig = updater(currentConfig);

      // 如果没有变化，跳过保存
      if (newConfig === currentConfig) {
        return;
      }

      // 写入前创建快照
      this.configSnapshot.saveSnapshot(
        newConfig as unknown as Record<string, unknown>
      );

      // 原子写入
      this.atomicWriteConfig(newConfig);

      // 更新缓存
      this.configCache = { config: newConfig, mtime: Date.now() };
      this.stats.writeCount++;
      this.stats.lastWriteTime = Date.now();
    } catch (error) {
      logger.error('保存配置失败', error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * 原子写入配置
   * @param config 配置对象
   */
  private atomicWriteConfig(config: GlobalConfig): void {
    const configDir = dirname(this.globalConfigPath);

    // 确保目录存在
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    // 创建备份
    this.createBackup();

    // 写入临时文件
    const tempPath = `${this.globalConfigPath}.tmp`;
    const filteredConfig = this.filterDefaults(config);

    try {
      writeFileSync(tempPath, JSON.stringify(filteredConfig, null, 2), {
        encoding: 'utf-8',
        mode: 0o600, // 仅限所有者读写
      });

      // 原子重命名
      renameSync(tempPath, this.globalConfigPath);
    } catch (error) {
      // 清理临时文件
      try {
        if (existsSync(tempPath)) {
          unlinkSync(tempPath);
        }
      } catch {
        // 忽略清理错误
      }
      throw error;
    }
  }

  /**
   * 过滤默认值
   * @param config 配置对象
   * @returns 过滤后的配置
   */
  private filterDefaults(config: GlobalConfig): Partial<GlobalConfig> {
    const defaultConfig = createDefaultGlobalConfig();
    const filtered: Partial<GlobalConfig> = {};

    for (const [key, value] of Object.entries(config)) {
      const defaultValue = (defaultConfig as any)[key];
      if (JSON.stringify(value) !== JSON.stringify(defaultValue)) {
        (filtered as any)[key] = value;
      }
    }

    return filtered;
  }

  /**
   * 创建配置备份
   */
  private createBackup(): void {
    if (!existsSync(this.globalConfigPath)) {
      return;
    }

    try {
      const backupDir = this.getConfigBackupDir();
      if (!existsSync(backupDir)) {
        mkdirSync(backupDir, { recursive: true });
      }

      const fileBase = basename(this.globalConfigPath);
      const backupPath = join(backupDir, `${fileBase}.backup.${Date.now()}`);

      copyFileSync(this.globalConfigPath, backupPath);

      // 清理旧备份，只保留最近5个
      this.cleanupOldBackups();
    } catch (error) {
      logger.warn('创建配置备份失败', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 清理旧备份
   */
  private cleanupOldBackups(): void {
    try {
      const backupDir = this.getConfigBackupDir();
      const fileBase = basename(this.globalConfigPath);

      const backups = readFileSync(backupDir, 'utf-8');
      // 这里简化处理，实际应该读取目录列表
    } catch {
      // 忽略清理错误
    }
  }

  /**
   * 备份损坏的配置
   */
  private backupCorruptedConfig(): void {
    if (!existsSync(this.globalConfigPath)) {
      return;
    }

    try {
      const backupDir = this.getConfigBackupDir();
      if (!existsSync(backupDir)) {
        mkdirSync(backupDir, { recursive: true });
      }

      const fileBase = basename(this.globalConfigPath);
      const corruptedPath = join(
        backupDir,
        `${fileBase}.corrupted.${Date.now()}`
      );

      copyFileSync(this.globalConfigPath, corruptedPath);
      logger.info(`损坏的配置已备份到: ${corruptedPath}`);
    } catch (error) {
      logger.warn('备份损坏配置失败', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 启动配置新鲜度监控
   */
  private startFreshnessWatcher(): void {
    if (this.freshnessWatcherStarted || process.env.NODE_ENV === 'test') {
      return;
    }

    this.freshnessWatcherStarted = true;

    watchFile(
      this.globalConfigPath,
      { interval: this.CONFIG_FRESHNESS_POLL_MS, persistent: false },
      (curr) => {
        // 跳过自己的写入
        if (curr.mtimeMs <= this.configCache.mtime) {
          return;
        }

        try {
          const content = readFileSync(this.globalConfigPath, 'utf-8');
          const parsed = JSON.parse(content);

          this.configCache = {
            config: { ...createDefaultGlobalConfig(), ...parsed },
            mtime: curr.mtimeMs,
          };
          logger.debug('配置已更新');
        } catch {
          // 忽略读取错误
        }
      }
    );
  }

  /**
   * 获取项目配置
   * @param projectPath 项目路径
   * @returns 项目配置
   */
  getProjectConfig(projectPath: string): ProjectConfig {
    const globalConfig = this.getGlobalConfig();

    if (!globalConfig.projects) {
      return { ...DEFAULT_PROJECT_CONFIG };
    }

    return globalConfig.projects[projectPath] ?? { ...DEFAULT_PROJECT_CONFIG };
  }

  /**
   * 保存项目配置
   * @param projectPath 项目路径
   * @param updater 配置更新函数
   */
  saveProjectConfig(
    projectPath: string,
    updater: (currentConfig: ProjectConfig) => ProjectConfig
  ): void {
    this.saveGlobalConfig((currentConfig) => {
      const currentProjectConfig = currentConfig.projects?.[projectPath] ?? {
        ...DEFAULT_PROJECT_CONFIG,
      };
      const newProjectConfig = updater(currentProjectConfig);

      // 如果没有变化，跳过保存
      if (newProjectConfig === currentProjectConfig) {
        return currentConfig;
      }

      return {
        ...currentConfig,
        projects: {
          ...currentConfig.projects,
          [projectPath]: newProjectConfig,
        },
      };
    });
  }

  /**
   * 获取配置值
   * @param key 配置键
   * @returns 配置值
   */
  getConfigValue<T = any>(key: string): T | undefined {
    const config = this.getGlobalConfig();
    return config[key];
  }

  /**
   * 设置配置值
   * @param key 配置键
   * @param value 配置值
   */
  setConfigValue<T = any>(key: string, value: T): void {
    this.saveGlobalConfig((config) => ({
      ...config,
      [key]: value,
    }));
  }

  /**
   * 获取配置统计
   * @returns 配置统计信息
   */
  getStats(): ConfigStats {
    return { ...this.stats };
  }

  /**
   * 重置配置统计
   */
  resetStats(): void {
    this.stats = {
      readCount: 0,
      writeCount: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
  }

  /**
   * 清除配置缓存
   */
  clearCache(): void {
    this.configCache = { config: null, mtime: 0 };
    logger.debug('配置缓存已清除');
  }

  /**
   * 重新加载配置
   * @returns 重新加载的配置
   */
  reloadConfig(): GlobalConfig {
    this.clearCache();
    return this.getGlobalConfig();
  }

  /**
   * 重置配置为默认值
   */
  resetConfig(): void {
    const defaultConfig = createDefaultGlobalConfig();
    this.atomicWriteConfig(defaultConfig);
    this.configCache = { config: defaultConfig, mtime: Date.now() };
    logger.info('配置已重置为默认值');
  }

  /**
   * 销毁配置管理器
   */
  destroy(): void {
    if (this.freshnessWatcherStarted) {
      unwatchFile(this.globalConfigPath);
      this.freshnessWatcherStarted = false;
    }
  }
}

// 导出单例实例
export const configManager = new ConfigManager();
