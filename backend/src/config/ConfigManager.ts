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
import { ConfigIO } from './io/ConfigIO';
import { deepMerge } from '../utils/common.js';
import { loadUserSettings } from './settings/userSettings.js';
import { loadProjectSettings } from './settings/projectSettings.js';
import { loadLocalSettings } from './settings/localSettings.js';
import {
  loadPolicySettings,
  isPolicySettingsAvailable,
} from './settings/policySettings.js';

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
  private configIO: ConfigIO;

  // --- 多源合并相关 ---
  private sourceConfigs: Map<string, Record<string, unknown>> = new Map();
  private mergedCache: Record<string, unknown> = {};
  private sourcePriority: string[] = [
    'userSettings',
    'projectSettings',
    'localSettings',
    'flagSettings',
    'policySettings',
  ];

  /**
   * 构造函数
   * @param configPath 配置文件路径
   * @param lockTimeout 文件锁超时时间（毫秒）
   */
  constructor(configPath?: string, lockTimeout?: number) {
    this.globalConfigPath = configPath || this.resolveConfigPath();
    const configDir = dirname(this.globalConfigPath);
    this.configSnapshot = createDefaultConfigSnapshot(configDir);
    this.configRecovery = new ConfigRecovery(
      this.configSnapshot,
      this.globalConfigPath
    );
    this.configIO = new ConfigIO(configDir, lockTimeout);
  }

  /**
   * 解析配置文件路径，含旧路径迁移
   * @returns 配置文件路径
   */
  private resolveConfigPath(): string {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    const oldPath = join(homeDir, '.PY_APP', 'config.json');
    const newPath = join(homeDir, '.pyapp', 'config.json');

    // 首次启动时自动迁移从 ~/.PY_APP/ 到 ~/.pyapp/
    if (existsSync(oldPath) && !existsSync(newPath)) {
      try {
        const data = readFileSync(oldPath, 'utf-8');
        mkdirSync(dirname(newPath), { recursive: true });
        writeFileSync(newPath, data, 'utf-8');
        renameSync(oldPath, oldPath + '.bak');
        logger.info('配置路径迁移完成', { from: oldPath, to: newPath });
      } catch (e) {
        logger.warn('配置路径迁移失败，继续使用旧路径', { error: String(e) });
        return oldPath;
      }
    }

    return newPath;
  }

  /**
   * 获取默认配置文件路径
   * @returns 默认配置文件路径
   */
  private getDefaultConfigPath(): string {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    return join(homeDir, '.pyapp', 'config.json');
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
    const lockPath = this.globalConfigPath + '.lock';

    // 获取文件锁
    this.configIO.acquireLock(lockPath);

    try {
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

      writeFileSync(tempPath, JSON.stringify(filteredConfig, null, 2), {
        encoding: 'utf-8',
        mode: 0o600, // 仅限所有者读写
      });

      // 原子重命名
      renameSync(tempPath, this.globalConfigPath);
    } catch (error) {
      // 清理临时文件
      try {
        const tempPath = `${this.globalConfigPath}.tmp`;
        if (existsSync(tempPath)) {
          unlinkSync(tempPath);
        }
      } catch {
        // 忽略清理错误
      }
      throw error;
    } finally {
      // 释放文件锁
      this.configIO.releaseLock(lockPath);
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

  // ========== 多源合并 ==========

  /**
   * 获取指定源的配置
   */
  getSourceConfig(source: string): Record<string, unknown> | undefined {
    return this.sourceConfigs.get(source);
  }

  /**
   * 设置指定源的配置
   */
  setSourceConfig(source: string, config: Record<string, unknown>): void {
    this.sourceConfigs.set(source, config);
    this.rebuildMergedConfig();
  }

  /**
   * 加载所有同步设置源
   * 优先级从低到高：userSettings < projectSettings < localSettings < flagSettings < policySettings
   */
  loadSyncSources(): void {
    this.sourceConfigs.set('userSettings', loadUserSettings());
    this.sourceConfigs.set('projectSettings', loadProjectSettings());
    this.sourceConfigs.set('localSettings', loadLocalSettings());
    this.sourceConfigs.set(
      'policySettings',
      isPolicySettingsAvailable() ? loadPolicySettings() : {}
    );
    this.rebuildMergedConfig();
  }

  /**
   * 刷新同步设置源
   */
  refreshSyncSources(): void {
    this.loadSyncSources();
  }

  /**
   * 获取合并后的多源配置
   */
  getMergedConfig(): Record<string, unknown> {
    return this.mergedCache;
  }

  /**
   * 重建合并配置
   * 按优先级合并各源：低优先级 < 高优先级
   */
  private rebuildMergedConfig(): void {
    let merged: Record<string, unknown> = {};

    for (const source of this.sourcePriority) {
      const config = this.sourceConfigs.get(source);
      if (config && Object.keys(config).length > 0) {
        merged = deepMerge(merged, config);
      }
    }

    this.mergedCache = merged;
  }

  /**
   * 获取设置值及其来源
   */
  getSettingWithSource(
    key: string
  ): { value: unknown; source: string } | undefined {
    const reversed = [...this.sourcePriority].reverse();

    for (const source of reversed) {
      const config = this.sourceConfigs.get(source);
      if (!config) continue;
      const keys = key.split('.');
      let current: Record<string, unknown> = config as Record<string, unknown>;
      let found = true;

      for (const k of keys) {
        if (
          current === null ||
          current === undefined ||
          typeof current !== 'object'
        ) {
          found = false;
          break;
        }
        current = current[k] as Record<string, unknown>;
      }

      if (found && current !== undefined) {
        return { value: current, source };
      }
    }

    return undefined;
  }

  // ========== 文件 I/O 委托（供 CliConfigManager 等外部模块使用） ==========

  /**
   * 读取任意 JSON 文件（使用文件锁）
   * @param filePath 文件路径
   * @returns 解析后的 JSON 对象，失败返回 null
   */
  readJsonFile(filePath: string): Record<string, unknown> | null {
    const lockPath = filePath + '.lock';
    this.configIO.acquireLock(lockPath);

    try {
      if (!existsSync(filePath)) {
        return null;
      }
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return null;
    } finally {
      this.configIO.releaseLock(lockPath);
    }
  }

  /**
   * 写入任意 JSON 文件（使用文件锁和原子写入）
   * @param filePath 文件路径
   * @param data JSON 数据
   */
  writeJsonFile(filePath: string, data: Record<string, unknown>): boolean {
    const lockPath = filePath + '.lock';
    const tempPath = filePath + '.tmp.' + process.pid + '.' + Date.now();

    if (!this.configIO.acquireLock(lockPath)) {
      return false;
    }

    try {
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(tempPath, JSON.stringify(data, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
      });
      renameSync(tempPath, filePath);
      return true;
    } catch (error) {
      try {
        if (existsSync(tempPath)) {
          unlinkSync(tempPath);
        }
      } catch {
        // 忽略清理错误
      }
      logger.error('JSON 文件写入失败', { filePath, error: String(error) });
      return false;
    } finally {
      this.configIO.releaseLock(lockPath);
    }
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
