//
/**
 * 远程配置管理器
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { logger } from '@modules/utils/log.js';

/**
 * 配置定义
 */
export interface ConfigDefinition<T = any> {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  defaultValue: T;
  description?: string;
  validation?: ConfigValidation;
  securityLevel?: SecurityLevel;
  version?: string;
  lastModified?: Date;
}

/**
 * 配置验证规则
 */
export interface ConfigValidation {
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: unknown[];
  custom?: (value: unknown) => boolean;
}

/**
 * 安全级别
 */
export enum SecurityLevel {
  PUBLIC = 'public',
  INTERNAL = 'internal',
  CONFIDENTIAL = 'confidential',
  SECRET = 'secret',
}

/**
 * 配置变更记录
 */
export interface ConfigChange {
  id: string;
  key: string;
  oldValue?: unknown;
  newValue: unknown;
  timestamp: Date;
  user?: string;
  reason?: string;
  version: string;
}

/**
 * 配置同步状态
 */
export interface SyncStatus {
  lastSync: Date;
  success: boolean;
  changes: number;
  errors: string[];
  duration: number;
}

/**
 * 配置审计记录
 */
export interface AuditRecord {
  id: string;
  action: 'read' | 'write' | 'delete' | 'sync';
  key: string;
  user: string;
  timestamp: Date;
  details?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

/**
 * 配置版本信息
 */
export interface ConfigVersion {
  version: string;
  timestamp: Date;
  changes: ConfigChange[];
  checksum: string;
  author?: string;
}

/**
 * 远程配置管理器
 *
 * @deprecated 请使用 @modules/config/ConfigManager 替代（全局配置 + 多源合并）。
 *   本类为独立的远程配置实现，与主配置系统功能重叠（多源合并、配置热更新）。
 *   远程配置功能应整合到 @modules/config/ConfigManager 中。
 *   此文件将在未来版本中移除。
 */
export class RemoteConfigManager {
  private configs: Map<string, ConfigDefinition> = new Map();
  private values: Map<string, any> = new Map();
  private changes: ConfigChange[] = [];
  private auditLog: AuditRecord[] = [];
  private versions: Map<string, ConfigVersion> = new Map();
  private syncStatus: SyncStatus;
  private securityChecker: SecurityChecker;
  private validator: ConfigValidator;

  constructor() {
    this.syncStatus = {
      lastSync: new Date(0),
      success: false,
      changes: 0,
      errors: [],
      duration: 0,
    };

    this.securityChecker = new SecurityChecker();
    this.validator = new ConfigValidator();
  }

  /**
   * 注册配置项
   */
  registerConfig<T>(definition: ConfigDefinition<T>): void {
    if (this.configs.has(definition.key)) {
      logger.warn(`Config ${definition.key} is already registered, skipping`);
      return;
    }

    // 设置默认值
    this.values.set(definition.key, definition.defaultValue);

    // 设置版本信息
    definition.version = definition.version || '1.0.0';
    definition.lastModified = new Date();

    this.configs.set(definition.key, definition);

    logger.info(`Registered config: ${definition.key} (${definition.type})`);
  }

  /**
   * 获取配置值
   */
  getConfig<T>(key: string): T {
    const definition = this.configs.get(key);
    if (!definition) {
      throw new AppError(
        `Config ${key} not found`,
        ErrorCategory.CONFIGURATION,
        ErrorSeverity.HIGH
      );
    }

    // 安全检查
    this.securityChecker.checkReadPermission(key);

    // 审计记录
    this.audit('read', key, 'system');

    return this.values.get(key) as T;
  }

  /**
   * 设置配置值
   */
  setConfig<T>(
    key: string,
    value: T,
    user: string = 'system',
    reason?: string
  ): void {
    const definition = this.configs.get(key);
    if (!definition) {
      throw new AppError(
        `Config ${key} not found`,
        ErrorCategory.CONFIGURATION,
        ErrorSeverity.HIGH
      );
    }

    // 安全检查
    this.securityChecker.checkWritePermission(key, user);

    // 验证配置值
    this.validator.validate(definition, value);

    const oldValue = this.values.get(key);

    // 记录变更
    const change: ConfigChange = {
      id: this.generateId(),
      key,
      oldValue,
      newValue: value,
      timestamp: new Date(),
      user,
      reason,
      version: definition.version || '1.0.0',
    };

    this.changes.push(change);
    this.values.set(key, value);

    // 更新版本信息
    definition.lastModified = new Date();

    // 审计记录
    this.audit('write', key, user, {
      oldValue,
      newValue: value,
      reason: reason || '',
    });

    logger.info(`Config ${key} updated by ${user}`);
  }

  /**
   * 同步远程配置
   */
  async sync(): Promise<SyncStatus> {
    const startTime = Date.now();

    try {
      logger.info('Starting config synchronization...');

      // 获取远程配置
      const remoteConfigs = await this.fetchRemoteConfigs();

      // 应用变更
      const changes = await this.applyRemoteChanges(remoteConfigs);

      // 更新同步状态
      this.syncStatus = {
        lastSync: new Date(),
        success: true,
        changes: changes.length,
        errors: [],
        duration: Date.now() - startTime,
      };

      // 创建版本快照
      await this.createVersionSnapshot(`sync_${Date.now()}`, changes);

      logger.info(
        `Config synchronization completed: ${changes.length} changes`
      );

      return this.syncStatus;
    } catch (error) {
      this.syncStatus = {
        lastSync: new Date(),
        success: false,
        changes: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        duration: Date.now() - startTime,
      };

      logger.error(
        'Config synchronization failed:',
        error instanceof Error ? error : undefined
      );

      return this.syncStatus;
    }
  }

  /**
   * 获取远程配置
   */
  private async fetchRemoteConfigs(): Promise<Map<string, any>> {
    // 模拟远程配置获取
    await new Promise((resolve) => setTimeout(resolve, 100));

    const remoteConfigs = new Map<string, any>();

    // 模拟一些远程配置值
    for (const [key, definition] of this.configs) {
      if (definition.securityLevel !== SecurityLevel.SECRET) {
        // 模拟远程值（可能与本地不同）
        const remoteValue = this.generateRemoteValue(definition);
        remoteConfigs.set(key, remoteValue);
      }
    }

    return remoteConfigs;
  }

  /**
   * 生成远程配置值（模拟）
   */
  private generateRemoteValue(definition: ConfigDefinition): unknown {
    // 模拟远程配置可能与本地不同
    if (Math.random() > 0.7) {
      // 30%的概率值不同
      switch (definition.type) {
        case 'number':
          return (definition.defaultValue as number) + Math.random() * 10;
        case 'boolean':
          return !definition.defaultValue;
        case 'string':
          return `${definition.defaultValue}_remote`;
        default:
          return definition.defaultValue;
      }
    }

    return definition.defaultValue;
  }

  /**
   * 应用远程变更
   */
  private async applyRemoteChanges(
    remoteConfigs: Map<string, any>
  ): Promise<ConfigChange[]> {
    const changes: ConfigChange[] = [];

    for (const [key, remoteValue] of remoteConfigs) {
      const localValue = this.values.get(key);
      const definition = this.configs.get(key);

      if (!definition) {
        logger.warn(`Remote config ${key} not found locally, skipping`);
        continue;
      }

      // 检查值是否不同
      if (JSON.stringify(localValue) !== JSON.stringify(remoteValue)) {
        try {
          // 验证远程值
          this.validator.validate(definition, remoteValue);

          // 记录变更
          const change: ConfigChange = {
            id: this.generateId(),
            key,
            oldValue: localValue,
            newValue: remoteValue,
            timestamp: new Date(),
            user: 'remote_sync',
            reason: 'Remote synchronization',
            version: definition.version || '1.0.0',
          };

          changes.push(change);
          this.values.set(key, remoteValue);

          logger.debug(`Applied remote change for ${key}`);
        } catch (error) {
          logger.error(
            `Failed to apply remote change for ${key}:`,
            error instanceof Error ? error : undefined
          );
        }
      }
    }

    return changes;
  }

  /**
   * 创建版本快照
   */
  private async createVersionSnapshot(
    version: string,
    changes: ConfigChange[]
  ): Promise<void> {
    const snapshot: ConfigVersion = {
      version,
      timestamp: new Date(),
      changes: [...changes], // 复制变更记录
      checksum: this.calculateChecksum(),
      author: 'remote_sync',
    };

    this.versions.set(version, snapshot);

    // 限制版本数量
    if (this.versions.size > 10) {
      const oldestVersion = Array.from(this.versions.keys())[0];
      this.versions.delete(oldestVersion);
    }

    logger.debug(`Created version snapshot: ${version}`);
  }

  /**
   * 回滚到指定版本
   */
  async rollback(version: string): Promise<void> {
    const targetVersion = this.versions.get(version);
    if (!targetVersion) {
      throw new AppError(
        `Version ${version} not found`,
        ErrorCategory.CONFIGURATION,
        ErrorSeverity.HIGH
      );
    }

    logger.info(`Rolling back to version ${version}...`);

    // 应用版本中的变更（反向）
    for (const change of targetVersion.changes.reverse()) {
      this.values.set(change.key, change.oldValue);

      // 记录回滚变更
      const rollbackChange: ConfigChange = {
        id: this.generateId(),
        key: change.key,
        oldValue: change.newValue,
        newValue: change.oldValue,
        timestamp: new Date(),
        user: 'system',
        reason: `Rollback to version ${version}`,
        version: change.version,
      };

      this.changes.push(rollbackChange);
    }

    // 创建回滚版本
    await this.createVersionSnapshot(
      `rollback_${version}`,
      targetVersion.changes
    );

    logger.info(`Rollback to version ${version} completed`);
  }

  /**
   * 订阅配置变更
   */
  subscribe(key: string, callback: (change: ConfigChange) => void): () => void {
    // 简化实现：定期检查变更
    const interval = setInterval(() => {
      const recentChanges = this.changes.filter(
        (change) =>
          change.key === key && change.timestamp > new Date(Date.now() - 5000) // 最近5秒的变更
      );

      recentChanges.forEach(callback);
    }, 1000);

    return () => clearInterval(interval);
  }

  /**
   * 获取配置审计日志
   */
  getAuditLog(filter?: {
    action?: string;
    key?: string;
    user?: string;
  }): AuditRecord[] {
    let records = [...this.auditLog];

    if (filter) {
      if (filter.action) {
        records = records.filter((r) => r.action === filter.action);
      }
      if (filter.key) {
        records = records.filter((r) => r.key === filter.key);
      }
      if (filter.user) {
        records = records.filter((r) => r.user === filter.user);
      }
    }

    return records.sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    );
  }

  /**
   * 获取配置版本历史
   */
  getVersionHistory(): ConfigVersion[] {
    return Array.from(this.versions.values()).sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    );
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `config_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 计算配置校验和
   */
  private calculateChecksum(): string {
    const configData = JSON.stringify(Array.from(this.values.entries()));
    // 简化实现：使用简单的哈希
    let hash = 0;
    for (let i = 0; i < configData.length; i++) {
      const char = configData.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }

  /**
   * 记录审计日志
   */
  private audit(
    action: string,
    key: string,
    user: string,
    details?: Record<string, unknown>
  ): void {
    const record: AuditRecord = {
      id: this.generateId(),
      action: action as 'read' | 'write' | 'delete' | 'sync',
      key,
      user,
      timestamp: new Date(),
      details,
    };

    this.auditLog.push(record);

    // 限制审计日志大小
    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-1000);
    }
  }
}

/**
 * 安全检查器
 */
class SecurityChecker {
  /**
   * 检查读取权限
   */
  checkReadPermission(key: string): void {
    // 简化实现：总是允许读取
    // 实际实现中应该检查用户权限和配置的安全级别
  }

  /**
   * 检查写入权限
   */
  checkWritePermission(key: string, user: string): void {
    // 简化实现：检查用户权限
    if (user === 'anonymous') {
      throw new AppError(
        `User ${user} does not have write permission for ${key}`,
        ErrorCategory.PERMISSION,
        ErrorSeverity.HIGH
      );
    }

    // 实际实现中应该检查更复杂的权限规则
  }
}

/**
 * 配置验证器
 */
class ConfigValidator {
  /**
   * 验证配置值
   */
  validate(definition: ConfigDefinition, value: unknown): void {
    if (definition.validation) {
      const validation = definition.validation;

      // 检查必填字段
      if (validation.required && (value === undefined || value === null)) {
        throw new AppError(
          `Config ${definition.key} is required`,
          ErrorCategory.VALIDATION,
          ErrorSeverity.HIGH
        );
      }

      // 检查数值范围
      if (
        definition.type === 'number' &&
        value !== undefined &&
        value !== null
      ) {
        const numValue = value as number;
        if (validation.min !== undefined && numValue < validation.min) {
          throw new AppError(
            `Config ${definition.key} must be >= ${validation.min}`,
            ErrorCategory.VALIDATION,
            ErrorSeverity.MEDIUM
          );
        }
        if (validation.max !== undefined && numValue > validation.max) {
          throw new AppError(
            `Config ${definition.key} must be <= ${validation.max}`,
            ErrorCategory.VALIDATION,
            ErrorSeverity.MEDIUM
          );
        }
      }

      // 检查枚举值
      if (validation.enum && !validation.enum.includes(value as never)) {
        throw new AppError(
          `Config ${definition.key} must be one of: ${validation.enum.join(', ')}`,
          ErrorCategory.VALIDATION,
          ErrorSeverity.MEDIUM
        );
      }

      // 检查正则表达式
      if (validation.pattern && definition.type === 'string') {
        if (!validation.pattern.test(value as string)) {
          throw new AppError(
            `Config ${definition.key} does not match pattern: ${validation.pattern}`,
            ErrorCategory.VALIDATION,
            ErrorSeverity.MEDIUM
          );
        }
      }

      // 自定义验证
      if (validation.custom && !validation.custom(value as never)) {
        throw new AppError(
          `Config ${definition.key} failed custom validation`,
          ErrorCategory.VALIDATION,
          ErrorSeverity.HIGH
        );
      }
    }

    // 类型检查
    this.validateType(definition.type, value);
  }

  /**
   * 类型验证
   */
  private validateType(type: string, value: unknown): void {
    if (value === undefined || value === null) {
      return; // 空值跳过类型检查
    }

    switch (type) {
      case 'number':
        if (typeof value !== 'number') {
          throw new AppError(
            `Expected number for config, got ${typeof value}`,
            ErrorCategory.VALIDATION,
            ErrorSeverity.MEDIUM
          );
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          throw new AppError(
            `Expected boolean for config, got ${typeof value}`,
            ErrorCategory.VALIDATION,
            ErrorSeverity.MEDIUM
          );
        }
        break;
      case 'string':
        if (typeof value !== 'string') {
          throw new AppError(
            `Expected string for config, got ${typeof value}`,
            ErrorCategory.VALIDATION,
            ErrorSeverity.MEDIUM
          );
        }
        break;
      case 'object':
        if (typeof value !== 'object' || Array.isArray(value)) {
          throw new AppError(
            `Expected object for config, got ${typeof value}`,
            ErrorCategory.VALIDATION,
            ErrorSeverity.MEDIUM
          );
        }
        break;
      case 'array':
        if (!Array.isArray(value)) {
          throw new AppError(
            `Expected array for config, got ${typeof value}`,
            ErrorCategory.VALIDATION,
            ErrorSeverity.MEDIUM
          );
        }
        break;
    }
  }
}

/**
 * 配置管理工具类
 */
export class ConfigUtils {
  /**
   * 创建数值配置
   */
  static createNumberConfig(
    key: string,
    defaultValue: number,
    options?: {
      min?: number;
      max?: number;
      description?: string;
      securityLevel?: SecurityLevel;
    }
  ): ConfigDefinition<number> {
    return {
      key,
      type: 'number',
      defaultValue,
      description: options?.description,
      securityLevel: options?.securityLevel || SecurityLevel.INTERNAL,
      validation: {
        min: options?.min,
        max: options?.max,
      },
    };
  }

  /**
   * 创建字符串配置
   */
  static createStringConfig(
    key: string,
    defaultValue: string,
    options?: {
      pattern?: RegExp;
      enum?: string[];
      description?: string;
      securityLevel?: SecurityLevel;
    }
  ): ConfigDefinition<string> {
    return {
      key,
      type: 'string',
      defaultValue,
      description: options?.description,
      securityLevel: options?.securityLevel || SecurityLevel.INTERNAL,
      validation: {
        pattern: options?.pattern,
        enum: options?.enum,
      },
    };
  }

  /**
   * 创建布尔配置
   */
  static createBooleanConfig(
    key: string,
    defaultValue: boolean,
    options?: {
      description?: string;
      securityLevel?: SecurityLevel;
    }
  ): ConfigDefinition<boolean> {
    return {
      key,
      type: 'boolean',
      defaultValue,
      description: options?.description,
      securityLevel: options?.securityLevel || SecurityLevel.INTERNAL,
    };
  }
}
