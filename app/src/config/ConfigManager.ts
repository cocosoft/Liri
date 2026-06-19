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
import { createHash } from 'node:crypto';
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
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { handleError } from '@modules/error';
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
import {
  resolveUserConfigPath,
  resolvePyappHome,
  ensureDir,
} from '@modules/core';
import {
  setRuntimeConfigSnapshot,
  clearRuntimeConfigSnapshot,
  getRuntimeConfigSnapshotMetadata,
  hashRuntimeConfigValue as hashRuntimeConfigSnapshotValue,
  registerRuntimeConfigWriteListener,
} from './RuntimeConfigSnapshot.js';

/**
 * 确定性 JSON 序列化，用于配置 Hash 计算
 * 保证相同配置值总是产生相同字符串
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

/**
 * 配置原子修改冲突错误
 * 在 mutateConfigFile() 检测到外部修改时抛出
 */
export class ConfigMutationConflictError extends AppError {
  readonly expectedHash: string | null;
  readonly actualHash: string | null;

  constructor(
    message: string,
    params: { expectedHash: string | null; actualHash: string | null }
  ) {
    super(
      message,
      ErrorCategory.CONFIGURATION,
      ErrorSeverity.HIGH,
      undefined,
      params
    );
    this.name = 'ConfigMutationConflictError';
    this.expectedHash = params.expectedHash;
    this.actualHash = params.actualHash;
  }
}

/**
 * 配置管理器类
 */
export class ConfigManager {
  private globalConfigPath: string;
  private configCache: { config: GlobalConfig | null; mtime: number } = {
    config: null,
    mtime: 0,
  };
  private configHash: string | null = null;
  private lastHashCheckTime: number = 0;
  private configHashRevision: number = 0;
  private stats: ConfigStats = {
    readCount: 0,
    writeCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    hashChecks: 0,
    hashMismatches: 0,
  };
  private freshnessWatcherStarted = false;
  private readonly CONFIG_FRESHNESS_POLL_MS = 1000;
  private readonly CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5分钟
  private readonly HASH_CHECK_INTERVAL_MS = 30000; // 30秒
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
    const pyappHome = resolvePyappHome();
    const LEGACY_CONFIG_DIR = '.Liri';
    const oldPath = join(pyappHome, '..', LEGACY_CONFIG_DIR, 'config.json');
    const newPath = resolveUserConfigPath();

    // 首次启动时自动迁移从 ~/.Liri/ 到 ~/.pyapp/
    if (existsSync(oldPath) && !existsSync(newPath)) {
      try {
        const data = readFileSync(oldPath, 'utf-8');
        ensureDir(dirname(newPath));
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
    return resolveUserConfigPath();
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
   * 每次调用都会周期性校验运行时快照 Hash，检测外部修改
   * @returns 全局配置
   */
  getGlobalConfig(): GlobalConfig {
    // 快速路径：内存读取 + 周期性 Hash 校验
    if (this.configCache.config) {
      this.stats.cacheHits++;
      // 周期性校验快照 Hash，检测外部修改
      if (this.shouldVerifyHash()) {
        this.verifyConfigHash();
      }
      return this.configCache.config;
    }

    // 慢速路径：从文件加载
    this.stats.cacheMisses++;

    // 配置系统未启用时，直接返回默认配置（不缓存），
    // 避免模块级单例在 enableConfigs() 前访问配置时抛出错误。
    // enableConfigs() 会再次调用 getGlobalConfig() 正常加载文件。
    if (!this.configReadingAllowed && this.env('NODE_ENV') !== 'test') {
      return createDefaultGlobalConfig();
    }

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
      this.configHash = this.computeHash(config);
      this.lastHashCheckTime = Date.now();
      this.configHashRevision++;
      this.stats.readCount++;
      this.stats.lastReadTime = Date.now();

      // 更新运行时配置快照
      setRuntimeConfigSnapshot(config);

      // 启动文件监控
      this.startFreshnessWatcher();
      return config;
    } catch (error) {
      void handleError(error, {
        module: 'config:manager',
        action: 'get_global_config',
      });
      // 诊断：记录调用栈
      logger.warning('getGlobalConfig catch 调用栈', {
        errorName: error instanceof Error ? error.name : typeof error,
        errorCode: (error as any)?.code,
        errorMessage: error instanceof Error ? error.message : String(error),
        stack: new Error().stack?.split('\n').slice(3).join('\n'),
        configReadingAllowed: this.configReadingAllowed,
      });
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
   * 判断是否需要进行 Hash 校验
   * 基于距离上次校验的时间间隔
   */
  private shouldVerifyHash(): boolean {
    return Date.now() - this.lastHashCheckTime >= this.HASH_CHECK_INTERVAL_MS;
  }

  /**
   * 计算配置对象的确定性 Hash 值
   * 使用 SHA-256 算法，保证相同配置产生相同 Hash
   */
  private computeHash(config: GlobalConfig): string {
    return createHash('sha256').update(stableStringify(config)).digest('hex');
  }

  /**
   * 无锁读取配置文件内容（用于 Hash 校验）
   * 不获取文件锁，避免并发竞争
   * @returns 文件内容字符串，读取失败返回 null
   */
  private readConfigFileSnapshot(): string | null {
    try {
      return readFileSync(this.globalConfigPath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * 校验运行时配置快照 Hash
   * 对比内存中配置的 Hash 与配置文件的 Hash
   * 不匹配时自动重载配置并记录告警
   */
  private verifyConfigHash(): void {
    if (!this.configHash || !this.configCache.config) {
      return;
    }

    this.stats.hashChecks = (this.stats.hashChecks ?? 0) + 1;
    this.lastHashCheckTime = Date.now();

    try {
      const fileContent = this.readConfigFileSnapshot();
      if (fileContent === null) {
        return;
      }

      const fileParsed = JSON.parse(fileContent);
      const fileHash = createHash('sha256')
        .update(stableStringify(fileParsed))
        .digest('hex');

      if (fileHash !== this.configHash) {
        this.stats.hashMismatches = (this.stats.hashMismatches ?? 0) + 1;
        logger.warn('配置文件外部修改检测，自动重载配置', {
          expectedHash: this.configHash,
          actualHash: fileHash,
          configPath: this.globalConfigPath,
        });
        this.reloadConfig();
      }
    } catch (error) {
      logger.warn('配置 Hash 校验失败，跳过本次校验', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 获取运行时配置快照信息
   * 委托给 RuntimeConfigSnapshot 模块，提供增强的快照元数据
   * @returns 运行时快照信息，包含 Hash、修订号和更新时间
   */
  getRuntimeSnapshot(): {
    hash: string;
    revision: number;
    updatedAt: number;
    fingerprint?: string;
    cacheKey?: string;
  } | null {
    const metadata = getRuntimeConfigSnapshotMetadata();
    if (!metadata && !this.configHash) {
      return null;
    }
    if (metadata) {
      return {
        hash: this.configHash ?? metadata.fingerprint,
        revision: metadata.revision,
        updatedAt: metadata.updatedAtMs,
        fingerprint: metadata.fingerprint,
        cacheKey: `runtime:${metadata.revision}:${metadata.fingerprint}`,
      };
    }
    return {
      hash: this.configHash!,
      revision: this.configHashRevision,
      updatedAt: this.lastHashCheckTime,
    };
  }

  /**
   * 从文件加载配置
   * @returns 全局配置
   */
  private loadConfigFromFile(): GlobalConfig {
    if (!this.configReadingAllowed && this.env('NODE_ENV') !== 'test') {
      logger.error('loadConfigFromFile 被禁止访问', {
        configReadingAllowed: this.configReadingAllowed,
        stack: new Error().stack?.split('\n').slice(2).join('\n'),
      });
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

      // 更新缓存和 Hash
      this.configCache = { config: newConfig, mtime: Date.now() };
      this.configHash = this.computeHash(newConfig);
      this.lastHashCheckTime = Date.now();
      this.configHashRevision++;
      this.stats.writeCount++;
      this.stats.lastWriteTime = Date.now();

      // 同步运行时快照
      setRuntimeConfigSnapshot(newConfig);
    } catch (error) {
      logger.error('保存配置失败', error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * 原子修改配置 — 读 → 改 → 写校验 模式
   * 写入前对比文件 Hash，检测到外部修改时抛出 ConfigMutationConflictError
   * @param mutator 配置变异函数，接收当前配置的深拷贝（draft），修改 draft 后返回
   * @returns 修改后的配置
   * @throws ConfigMutationConflictError 当检测到外部修改时
   */
  mutateConfigFile(mutator: (draft: GlobalConfig) => void): GlobalConfig {
    const expectedHash = this.configHash;

    // 克隆当前配置作为 draft
    const draft: GlobalConfig = structuredClone(this.getGlobalConfig());

    // 应用变异
    mutator(draft);

    // 写入前验证文件未被外部修改 —— 重新读取文件并计算 Hash
    try {
      const fileContent = this.readConfigFileSnapshot();
      if (fileContent !== null) {
        const fileParsed = JSON.parse(fileContent);
        const fileHash = createHash('sha256')
          .update(stableStringify(fileParsed))
          .digest('hex');

        if (expectedHash !== null && fileHash !== expectedHash) {
          this.stats.hashMismatches = (this.stats.hashMismatches ?? 0) + 1;
          throw new ConfigMutationConflictError(
            '配置自上次加载后已被外部修改，写入冲突',
            { expectedHash, actualHash: fileHash }
          );
        }
      }
    } catch (error) {
      if (error instanceof ConfigMutationConflictError) {
        throw error;
      }
      logger.warn('原子修改预检失败，继续执行写入', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 执行原子写入
    this.atomicWriteConfig(draft);

    // 更新缓存和 Hash
    this.configCache = { config: draft, mtime: Date.now() };
    this.configHash = this.computeHash(draft);
    this.lastHashCheckTime = Date.now();
    this.configHashRevision++;
    this.stats.writeCount++;
    this.stats.lastWriteTime = Date.now();

    // 同步运行时快照
    setRuntimeConfigSnapshot(draft);

    logger.debug('配置原子修改完成');
    return draft;
  }

  /**
   * 原子写入配置
   * 使用唯一临时文件名（pid + timestamp），避免多进程冲突
   * 写入完成后通过 rename 实现原子替换
   * @param config 配置对象
   */
  private atomicWriteConfig(config: GlobalConfig): void {
    const lockPath = this.globalConfigPath + '.lock';

    // 获取文件锁
    this.configIO.acquireLock(lockPath);

    let tempPath = '';

    try {
      const configDir = dirname(this.globalConfigPath);

      // 确保目录存在
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }

      // 创建备份
      this.createBackup();

      // 写入临时文件（唯一名称，避免多进程冲突）
      tempPath = `${this.globalConfigPath}.tmp.${process.pid}.${Date.now()}`;
      const filteredConfig = this.filterDefaults(config);

      writeFileSync(tempPath, JSON.stringify(filteredConfig, null, 2), {
        encoding: 'utf-8',
        mode: 0o600, // 仅限所有者读写
      });

      // 原子重命名
      renameSync(tempPath, this.globalConfigPath);
    } catch (error) {
      // 清理临时文件
      if (tempPath && existsSync(tempPath)) {
        try {
          unlinkSync(tempPath);
        } catch {
          // 忽略清理错误
        }
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
    if (this.freshnessWatcherStarted || this.env('NODE_ENV') === 'test') {
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

          const mergedConfig: GlobalConfig = {
            ...createDefaultGlobalConfig(),
            ...parsed,
          };

          this.configCache = {
            config: mergedConfig,
            mtime: curr.mtimeMs,
          };
          this.configHash = this.computeHash(mergedConfig);
          this.lastHashCheckTime = Date.now();
          this.configHashRevision++;
          setRuntimeConfigSnapshot(mergedConfig);
          logger.debug('文件监控检测到配置变更，已更新缓存和快照');
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
      hashChecks: 0,
      hashMismatches: 0,
    };
  }

  /**
   * 获取环境变量值（统一入口）
   *
   * 所有 process.env 读取应优先通过此方法访问，便于集中管理和审计。
   * 当前为轻量代理层，后续可扩展为支持默认值、类型转换、变量白名单等功能。
   *
   * @param name 环境变量名称
   * @param defaultValue 可选默认值
   */
  env(name: string, defaultValue?: string): string | undefined {
    return process.env[name] ?? defaultValue;
  }

  /**
   * 清除配置缓存和运行时快照
   */
  clearCache(): void {
    this.configCache = { config: null, mtime: 0 };
    this.configHash = null;
    this.lastHashCheckTime = 0;
    clearRuntimeConfigSnapshot();
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
    this.configHash = this.computeHash(defaultConfig);
    this.lastHashCheckTime = Date.now();
    this.configHashRevision++;
    setRuntimeConfigSnapshot(defaultConfig);
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

let _configManager: ConfigManager | undefined;

/**
 * 获取全局 ConfigManager 单例（懒加载）
 * 避免模块加载时直接实例化导致的循环依赖 TDZ 问题
 */
export function getConfigManager(): ConfigManager {
  if (!_configManager) {
    _configManager = new ConfigManager();
  }
  return _configManager;
}

// 使用 Proxy 保持向后兼容，所有现有 import { configManager } 仍可正常工作
export const configManager = new Proxy({} as ConfigManager, {
  get(_, prop: keyof ConfigManager) {
    const instance = getConfigManager();
    const value = instance[prop];
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  },
  set(_, prop: keyof ConfigManager, value) {
    (getConfigManager() as any)[prop] = value;
    return true;
  },
});
