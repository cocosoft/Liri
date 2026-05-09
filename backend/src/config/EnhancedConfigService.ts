/**
 * 配置管理服务
 * 支持配置验证、迁移、原子写入和并发控制
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * 配置版本号
 */
const CURRENT_CONFIG_VERSION = 2;

/**
 * 配置验证级别
 */
export enum ConfigValidationLevel {
  STRICT = 'strict',
  NORMAL = 'normal',
  LENIENT = 'lenient',
}

/**
 * 配置验证规则
 */
export interface ConfigValidationRule {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'function';
  required?: boolean;
  default?: any;
  validate?: (value: any) => boolean | string;
  message?: string;
  min?: number;
  max?: number;
  pattern?: RegExp;
}

/**
 * 配置验证结果
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: ConfigValidationError[];
  warnings: ConfigValidationWarning[];
}

/**
 * 配置验证错误
 */
export interface ConfigValidationError {
  key: string;
  message: string;
  value?: any;
}

/**
 * 配置验证警告
 */
export interface ConfigValidationWarning {
  key: string;
  message: string;
  value?: any;
}

/**
 * 迁移函数类型
 */
export type ConfigMigrationFunction = (
  config: Record<string, any>,
  fromVersion: number
) => Record<string, any>;

/**
 * 迁移记录
 */
interface ConfigMigrationRecord {
  fromVersion: number;
  toVersion: number;
  migrate: ConfigMigrationFunction;
}

/**
 * 配置元数据
 */
interface ConfigMetadata {
  version: number;
  createdAt: number;
  updatedAt: number;
  checksum: string;
}

/**
 * 持久化配置数据
 */
interface PersistedConfig {
  version: number;
  data: Record<string, any>;
  metadata: ConfigMetadata;
}

/**
 * 文件锁接口
 */
interface ConfigFileLock {
  fd: number;
  exclusive: boolean;
}

/**
 * 增强配置验证结果
 */
export interface EnhancedConfigValidationResult extends ConfigValidationResult {
  correctedConfig: Record<string, any>;
  appliedCorrections: string[];
}

/**
 * 增强配置服务
 */
export class EnhancedConfigService {
  private config: Record<string, any> = {};
  private migrations: Map<number, ConfigMigrationRecord> = new Map();
  private validationRules: Map<string, ConfigValidationRule> = new Map();
  private validationLevel: ConfigValidationLevel = ConfigValidationLevel.NORMAL;
  private isLoaded: boolean = false;
  private isDirty: boolean = false;
  private locks: Map<string, ConfigFileLock> = new Map();
  private configPath: string;
  private lockPath: string;
  private lockTimeout: number = 5000;
  private enableAtomicWrite: boolean = true;
  private enableLocking: boolean = true;
  private enableVersionMigration: boolean = true;
  private loadedVersion: number = 0;

  /**
   * 构造函数
   */
  constructor(
    configPath?: string,
    options?: {
      lockTimeout?: number;
      enableAtomicWrite?: boolean;
      enableLocking?: boolean;
      enableVersionMigration?: boolean;
      validationLevel?: ConfigValidationLevel;
    }
  ) {
    this.configPath = configPath || this.getDefaultConfigPath();
    this.lockPath = `${this.configPath}.lock`;

    if (options) {
      this.lockTimeout = options.lockTimeout || 5000;
      this.enableAtomicWrite = options.enableAtomicWrite ?? true;
      this.enableLocking = options.enableLocking ?? true;
      this.enableVersionMigration = options.enableVersionMigration ?? true;
      this.validationLevel =
        options.validationLevel || ConfigValidationLevel.NORMAL;
    }

    this.setupConfigDir();
    this.registerDefaultMigrations();
    this.registerDefaultValidationRules();
  }

  /**
   * 获取默认配置路径
   */
  private getDefaultConfigPath(): string {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    return path.join(homeDir, '.PY_APP', 'config.json');
  }

  /**
   * 设置配置目录
   */
  private setupConfigDir(): void {
    const configDir = path.dirname(this.configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
  }

  /**
   * 注册默认迁移
   */
  private registerDefaultMigrations(): void {
    this.registerMigration(1, 2, (config) => {
      return {
        ...config,
        version: 2,
        settings: {
          ...config.settings,
          validation: config.settings?.validation || {
            level: 'normal',
            validateOnLoad: true,
          },
        },
      };
    });
  }

  /**
   * 注册默认验证规则
   */
  private registerDefaultValidationRules(): void {
    this.addValidationRule({
      key: 'version',
      type: 'number',
      required: true,
      validate: (v) => v >= 1,
      message: 'Version must be a positive number',
    });

    this.addValidationRule({
      key: 'debug',
      type: 'boolean',
      required: false,
      default: false,
    });

    this.addValidationRule({
      key: 'verbose',
      type: 'boolean',
      required: false,
      default: false,
    });
  }

  /**
   * 添加验证规则
   */
  public addValidationRule(rule: ConfigValidationRule): void {
    this.validationRules.set(rule.key, rule);
  }

  /**
   * 注册配置迁移
   */
  public registerMigration(
    fromVersion: number,
    toVersion: number,
    migrateFn: ConfigMigrationFunction
  ): void {
    this.migrations.set(fromVersion, {
      fromVersion,
      toVersion,
      migrate: migrateFn,
    });
  }

  /**
   * 设置验证级别
   */
  public setValidationLevel(level: ConfigValidationLevel): void {
    this.validationLevel = level;
  }

  /**
   * 加载配置
   */
  public load(): void {
    try {
      if (!fs.existsSync(this.configPath)) {
        this.config = {};
        this.isLoaded = true;
        return;
      }

      let content: string;
      if (this.enableLocking) {
        content = this.readFileWithLock();
      } else {
        content = fs.readFileSync(this.configPath, 'utf8');
      }

      const persistedConfig: PersistedConfig = JSON.parse(content);
      this.loadedVersion = persistedConfig.version;

      let loadedData = persistedConfig.data;

      if (
        this.enableVersionMigration &&
        persistedConfig.version < CURRENT_CONFIG_VERSION
      ) {
        loadedData = this.migrateConfig(loadedData, persistedConfig.version);
      }

      const validationResult = this.validate(loadedData);

      if (
        !validationResult.valid &&
        this.validationLevel === ConfigValidationLevel.STRICT
      ) {
        throw new Error(
          `Configuration validation failed: ${validationResult.errors.map((e) => e.message).join(', ')}`
        );
      }

      if (validationResult.errors.length > 0) {
        this.config = validationResult.correctedConfig;
      } else {
        this.config = loadedData;
      }

      this.isLoaded = true;
    } catch (error) {
      console.error('Failed to load config:', error);
      this.config = {};
      this.isLoaded = true;
    }
  }

  /**
   * 读取文件（带锁）
   */
  private readFileWithLock(): string {
    this.acquireLock();
    try {
      return fs.readFileSync(this.configPath, 'utf8');
    } finally {
      this.releaseLock();
    }
  }

  /**
   * 迁移配置
   */
  private migrateConfig(
    config: Record<string, any>,
    fromVersion: number
  ): Record<string, any> {
    let currentConfig = { ...config };
    let currentVersion = fromVersion;

    while (currentVersion < CURRENT_CONFIG_VERSION) {
      const migration = this.migrations.get(currentVersion);
      if (migration) {
        currentConfig = migration.migrate(currentConfig, currentVersion);
        currentVersion = migration.toVersion;
      } else {
        break;
      }
    }

    return currentConfig;
  }

  /**
   * 验证配置
   */
  public validate(config: Record<string, any>): EnhancedConfigValidationResult {
    const errors: ConfigValidationError[] = [];
    const warnings: ConfigValidationWarning[] = [];
    const correctedConfig = { ...config };
    const appliedCorrections: string[] = [];

    for (const [key, rule] of this.validationRules) {
      const value = config[key];

      if (rule.required && value === undefined) {
        if (rule.default !== undefined) {
          correctedConfig[key] = rule.default;
          appliedCorrections.push(
            `Added default value for required field: ${key}`
          );
        } else {
          errors.push({
            key,
            message: rule.message || `Missing required config key: ${key}`,
            value,
          });
        }
        continue;
      }

      if (value !== undefined) {
        if (typeof value !== rule.type && rule.type !== 'function') {
          if (this.validationLevel !== ConfigValidationLevel.LENIENT) {
            errors.push({
              key,
              message:
                rule.message ||
                `Invalid type for ${key}: expected ${rule.type}, got ${typeof value}`,
              value,
            });
          } else {
            warnings.push({
              key,
              message: `Type mismatch for ${key}, treating as valid in lenient mode`,
              value,
            });
          }
        }

        if (
          rule.min !== undefined &&
          typeof value === 'number' &&
          value < rule.min
        ) {
          if (this.validationLevel === ConfigValidationLevel.LENIENT) {
            correctedConfig[key] = rule.min;
            appliedCorrections.push(
              `Corrected ${key} to minimum value: ${rule.min}`
            );
          } else {
            errors.push({
              key,
              message:
                rule.message ||
                `Value for ${key} is below minimum: ${rule.min}`,
              value,
            });
          }
        }

        if (
          rule.max !== undefined &&
          typeof value === 'number' &&
          value > rule.max
        ) {
          if (this.validationLevel === ConfigValidationLevel.LENIENT) {
            correctedConfig[key] = rule.max;
            appliedCorrections.push(
              `Corrected ${key} to maximum value: ${rule.max}`
            );
          } else {
            errors.push({
              key,
              message:
                rule.message || `Value for ${key} exceeds maximum: ${rule.max}`,
              value,
            });
          }
        }

        if (
          rule.pattern &&
          typeof value === 'string' &&
          !rule.pattern.test(value)
        ) {
          errors.push({
            key,
            message:
              rule.message ||
              `Value for ${key} does not match required pattern`,
            value,
          });
        }

        if (rule.validate && typeof rule.validate === 'function') {
          const result = rule.validate(value);
          if (result === false) {
            errors.push({
              key,
              message: rule.message || `Value for ${key} failed validation`,
              value,
            });
          } else if (typeof result === 'string') {
            errors.push({
              key,
              message: result,
              value,
            });
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      correctedConfig,
      appliedCorrections,
    };
  }

  /**
   * 保存配置
   */
  public save(): void {
    if (!this.isDirty) {
      return;
    }

    const dataToSave: PersistedConfig = {
      version: CURRENT_CONFIG_VERSION,
      data: this.config,
      metadata: {
        version: CURRENT_CONFIG_VERSION,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        checksum: this.calculateChecksum(this.config),
      },
    };

    const content = JSON.stringify(dataToSave, null, 2);

    if (this.enableAtomicWrite) {
      this.atomicWrite(content);
    } else {
      this.directWrite(content);
    }

    this.isDirty = false;
  }

  /**
   * 原子写入
   */
  private atomicWrite(content: string): void {
    const tempPath = `${this.configPath}.tmp.${process.pid}.${Date.now()}`;

    try {
      if (this.enableLocking) {
        this.acquireLock();
      }

      fs.writeFileSync(tempPath, content, 'utf8');
      fs.renameSync(tempPath, this.configPath);
    } catch (error) {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      throw error;
    } finally {
      if (this.enableLocking) {
        this.releaseLock();
      }
    }
  }

  /**
   * 直接写入
   */
  private directWrite(content: string): void {
    fs.writeFileSync(this.configPath, content, 'utf8');
  }

  /**
   * 获取文件锁
   */
  private acquireLock(): void {
    if (!this.enableLocking) {
      return;
    }

    const startTime = Date.now();

    while (Date.now() - startTime < this.lockTimeout) {
      try {
        const fd = fs.openSync(this.lockPath, 'wx');
        this.locks.set(this.lockPath, { fd, exclusive: true });
        return;
      } catch (error: any) {
        if (error.code === 'EEXIST') {
          try {
            fs.unlinkSync(this.lockPath);
          } catch {
            // 忽略删除错误
          }
          continue;
        }
        throw error;
      }
    }

    throw new Error(
      `Failed to acquire config lock after ${this.lockTimeout}ms`
    );
  }

  /**
   * 释放文件锁
   */
  private releaseLock(): void {
    if (!this.enableLocking) {
      return;
    }

    const lock = this.locks.get(this.lockPath);
    if (lock) {
      try {
        fs.closeSync(lock.fd);
      } catch {
        // 忽略关闭错误
      }
      this.locks.delete(this.lockPath);

      try {
        if (fs.existsSync(this.lockPath)) {
          fs.unlinkSync(this.lockPath);
        }
      } catch {
        // 忽略删除错误
      }
    }
  }

  /**
   * 计算校验和
   */
  private calculateChecksum(config: Record<string, any>): string {
    const content = JSON.stringify(config);
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * 获取配置值
   */
  public get(key?: string): any {
    if (!this.isLoaded) {
      this.load();
    }

    if (key) {
      return this.config[key];
    }

    return { ...this.config };
  }

  /**
   * 设置配置值
   */
  public set(key: string, value: any): void {
    if (!this.isLoaded) {
      this.load();
    }

    this.config[key] = value;
    this.isDirty = true;
  }

  /**
   * 更新配置
   */
  public update(updates: Record<string, any>): void {
    if (!this.isLoaded) {
      this.load();
    }

    for (const [key, value] of Object.entries(updates)) {
      this.config[key] = value;
    }
    this.isDirty = true;
  }

  /**
   * 删除配置项
   */
  public delete(key: string): boolean {
    if (!this.isLoaded) {
      this.load();
    }

    if (key in this.config) {
      delete this.config[key];
      this.isDirty = true;
      return true;
    }
    return false;
  }

  /**
   * 检查配置项是否存在
   */
  public has(key: string): boolean {
    if (!this.isLoaded) {
      this.load();
    }
    return key in this.config;
  }

  /**
   * 获取所有配置键
   */
  public keys(): string[] {
    if (!this.isLoaded) {
      this.load();
    }
    return Object.keys(this.config);
  }

  /**
   * 清空配置
   */
  public clear(): void {
    this.config = {};
    this.isDirty = true;
  }

  /**
   * 重置为默认配置
   */
  public reset(): void {
    this.config = {};
    this.isDirty = true;
  }

  /**
   * 强制保存
   */
  public forceSave(): void {
    this.isDirty = true;
    this.save();
  }

  /**
   * 检查是否已修改
   */
  public isModified(): boolean {
    return this.isDirty;
  }

  /**
   * 获取配置路径
   */
  public getConfigPath(): string {
    return this.configPath;
  }

  /**
   * 获取当前版本
   */
  public getVersion(): number {
    return CURRENT_CONFIG_VERSION;
  }

  /**
   * 获取加载时的版本
   */
  public getLoadedVersion(): number {
    return this.loadedVersion;
  }

  /**
   * 销毁服务
   */
  public destroy(): void {
    this.save();
    this.config = {};
    this.isLoaded = false;
  }

  /**
   * 备份配置
   */
  public backup(): string {
    if (!this.isLoaded) {
      this.load();
    }

    const backupPath = `${this.configPath}.backup.${Date.now()}`;
    const backupContent: PersistedConfig = {
      version: CURRENT_CONFIG_VERSION,
      data: this.config,
      metadata: {
        version: CURRENT_CONFIG_VERSION,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        checksum: this.calculateChecksum(this.config),
      },
    };

    fs.writeFileSync(
      backupPath,
      JSON.stringify(backupContent, null, 2),
      'utf8'
    );
    return backupPath;
  }

  /**
   * 从备份恢复
   */
  public restoreFromBackup(backupPath: string): boolean {
    try {
      if (!fs.existsSync(backupPath)) {
        return false;
      }

      const content = fs.readFileSync(backupPath, 'utf8');
      const backupData: PersistedConfig = JSON.parse(content);

      this.config = backupData.data;
      this.isDirty = true;
      this.save();

      return true;
    } catch (error) {
      console.error('Failed to restore from backup:', error);
      return false;
    }
  }
}

/**
 * 创建增强配置服务实例
 */
export function createEnhancedConfigService(
  configPath?: string,
  options?: {
    lockTimeout?: number;
    enableAtomicWrite?: boolean;
    enableLocking?: boolean;
    validationLevel?: ConfigValidationLevel;
  }
): EnhancedConfigService {
  return new EnhancedConfigService(configPath, options);
}

/**
 * 默认配置服务实例
 */
let defaultConfigService: EnhancedConfigService | null = null;

/**
 * 获取默认配置服务
 */
export function getDefaultConfigService(): EnhancedConfigService {
  if (!defaultConfigService) {
    defaultConfigService = new EnhancedConfigService();
  }
  return defaultConfigService;
}
