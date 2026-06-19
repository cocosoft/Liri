/**
 * 数据库备份管理器
 * 提供 SQLite 数据库的全量备份、恢复和自动清理功能
 * 备份目录: app/data/backups/（第二层，不跟踪）
 * 命名格式: {dbname}-{YYYY-MM-DD}T{HH-mm-ss}.db
 * 保留策略: 默认保留最近 7 个备份
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'fs';
import { join, basename, dirname, resolve, extname } from 'path';

import { resolveDataDir, resolveDbPath } from '@modules/core';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'monitoring:backup',
});

/**
 * 数据库注册信息
 */
export interface DatabaseEntry {
  /** 数据库文件路径（绝对路径或相对于 CWD） */
  dbPath: string;
  /** 显示名称（用于日志和备份文件名） */
  name: string;
}

/**
 * 备份结果
 */
export interface BackupResult {
  /** 数据库名称 */
  name: string;
  /** 备份文件路径 */
  backupPath: string;
  /** 备份文件大小（字节） */
  size: number;
  /** 是否成功 */
  success: boolean;
  /** 错误信息（仅失败时） */
  error?: string;
}

/**
 * 恢复结果
 */
export interface RestoreResult {
  /** 数据库名称 */
  name: string;
  /** 源备份文件 */
  backupPath: string;
  /** 目标数据库文件 */
  dbPath: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息（仅失败时） */
  error?: string;
}

/**
 * 清理结果
 */
export interface CleanupResult {
  /** 数据库名称 */
  name: string;
  /** 已删除的备份文件数 */
  deletedCount: number;
  /** 剩余备份文件数 */
  remainingCount: number;
  /** 释放空间（字节） */
  freedBytes: number;
}

/**
 * 备份配置
 */
export interface BackupConfig {
  /** 备份根目录 */
  backupDir: string;
  /** 最大保留备份数（默认 7） */
  maxBackups: number;
  /** 是否启用启动时自动备份 */
  enabled: boolean;
  /** 备份间隔（毫秒），启动时检查：距上次备份超过此值才备份 */
  backupIntervalMs: number;
}

/** 默认备份保留数量 */
const DEFAULT_MAX_BACKUPS = 7;

/** 默认备份间隔（24 小时） */
const DEFAULT_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 获取默认备份目录（懒加载，避免模块加载时调用 resolveDataDir 导致循环依赖 TDZ） */
function getDefaultBackupDir(): string {
  return join(resolveDataDir(), 'backups');
}

/**
 * 数据库备份管理器
 */
export class BackupManager {
  private registeredDatabases: Map<string, DatabaseEntry> = new Map();
  private config: BackupConfig;
  private backupHistory: Map<string, string[]> = new Map();

  /**
   * @param config 备份配置
   */
  constructor(config?: Partial<BackupConfig>) {
    this.config = {
      backupDir: config?.backupDir ?? getDefaultBackupDir(),
      maxBackups: config?.maxBackups ?? DEFAULT_MAX_BACKUPS,
      enabled: config?.enabled ?? true,
      backupIntervalMs: config?.backupIntervalMs ?? DEFAULT_BACKUP_INTERVAL_MS,
    };
  }

  /**
   * 注册需要备份的数据库
   * @param entry 数据库注册信息
   */
  registerDatabase(entry: DatabaseEntry): void {
    const resolvedPath = resolve(entry.dbPath);
    this.registeredDatabases.set(entry.name, {
      ...entry,
      dbPath: resolvedPath,
    });
    logger.info(`已注册数据库: ${entry.name}`, { dbPath: resolvedPath });
  }

  /**
   * 批量注册数据库
   * @param entries 数据库注册信息列表
   */
  registerDatabases(entries: DatabaseEntry[]): void {
    for (const entry of entries) {
      this.registerDatabase(entry);
    }
  }

  /**
   * 获取已注册的数据库列表
   * @returns 数据库注册信息列表
   */
  getRegisteredDatabases(): DatabaseEntry[] {
    return Array.from(this.registeredDatabases.values());
  }

  /**
   * 备份单个数据库
   * @param name 数据库名称（需已注册）
   * @returns 备份结果
   */
  backupDatabase(name: string): BackupResult {
    const entry = this.registeredDatabases.get(name);
    if (!entry) {
      return {
        name,
        backupPath: '',
        size: 0,
        success: false,
        error: `未注册的数据库: ${name}`,
      };
    }

    const dbPath = entry.dbPath;
    if (!existsSync(dbPath)) {
      return {
        name,
        backupPath: '',
        size: 0,
        success: false,
        error: `数据库文件不存在: ${dbPath}`,
      };
    }

    try {
      const backupDir = this.getDbBackupDir(name);
      if (!existsSync(backupDir)) {
        mkdirSync(backupDir, { recursive: true });
      }

      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .replace(/T/, 'T');
      const backupFileName = `${name}-${timestamp}.db`;
      const backupPath = join(backupDir, backupFileName);

      copyFileSync(dbPath, backupPath);

      const stats = statSync(backupPath);

      this.recordBackup(name, backupPath);

      logger.info(`数据库备份完成: ${name}`, {
        backupPath,
        size: stats.size,
      });

      return {
        name,
        backupPath,
        size: stats.size,
        success: true,
      };
    } catch (error) {
      void handleError(error, {
        module: 'monitoring:backup',
        action: 'backup_database',
        context: { dbName: name },
      });
      return {
        name,
        backupPath: '',
        size: 0,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 备份所有已注册的数据库
   * @returns 备份结果列表
   */
  backupAll(): BackupResult[] {
    if (!this.config.enabled) {
      logger.info('备份已禁用，跳过');
      return [];
    }

    const results: BackupResult[] = [];
    for (const [name] of this.registeredDatabases) {
      const result = this.backupDatabase(name);
      results.push(result);
    }
    return results;
  }

  /**
   * 仅当数据库存在且距上次备份超过间隔时，才执行备份
   * @returns 备份结果列表
   */
  backupIfNeeded(): BackupResult[] {
    if (!this.config.enabled) {
      return [];
    }

    const results: BackupResult[] = [];
    for (const [name] of this.registeredDatabases) {
      if (this.shouldBackup(name)) {
        const result = this.backupDatabase(name);
        results.push(result);
      }
    }
    return results;
  }

  /**
   * 列出指定数据库的备份文件
   * @param name 数据库名称
   * @returns 备份文件路径列表（按修改时间降序）
   */
  listBackups(name: string): string[] {
    const backupDir = this.getDbBackupDir(name);
    if (!existsSync(backupDir)) {
      return [];
    }

    const files = readdirSync(backupDir)
      .filter((f) => f.endsWith('.db') && f.startsWith(`${name}-`))
      .map((f) => join(backupDir, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

    return files;
  }

  /**
   * 从备份文件恢复数据库
   * @param name 数据库名称
   * @param backupPath 备份文件路径（若为空则使用最新备份）
   * @returns 恢复结果
   */
  restore(name: string, backupPath?: string): RestoreResult {
    const entry = this.registeredDatabases.get(name);
    if (!entry) {
      return {
        name,
        backupPath: backupPath || '',
        dbPath: '',
        success: false,
        error: `未注册的数据库: ${name}`,
      };
    }

    const targetBackup = backupPath || this.listBackups(name)[0];
    if (!targetBackup || !existsSync(targetBackup)) {
      return {
        name,
        backupPath: targetBackup || '',
        dbPath: entry.dbPath,
        success: false,
        error: '没有可用的备份文件',
      };
    }

    try {
      copyFileSync(targetBackup, entry.dbPath);
      logger.info(`数据库恢复完成: ${name}`, {
        from: targetBackup,
        to: entry.dbPath,
      });
      return {
        name,
        backupPath: targetBackup,
        dbPath: entry.dbPath,
        success: true,
      };
    } catch (error) {
      void handleError(error, {
        module: 'monitoring:backup',
        action: 'restore_database',
        context: { dbName: name },
      });
      return {
        name,
        backupPath: targetBackup,
        dbPath: entry.dbPath,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 清理旧备份，仅保留最近的 N 个
   * @param name 数据库名称（为空则清理所有）
   * @returns 清理结果列表
   */
  cleanup(name?: string): CleanupResult[] {
    const names = name ? [name] : Array.from(this.registeredDatabases.keys());
    const results: CleanupResult[] = [];

    for (const dbName of names) {
      const result = this.cleanupDatabase(dbName);
      results.push(result);
    }

    return results;
  }

  /**
   * 获取备份目录
   * @returns 备份根目录路径
   */
  getBackupDir(): string {
    return resolve(this.config.backupDir);
  }

  /**
   * 更新配置
   * @param config 配置片段
   */
  updateConfig(config: Partial<BackupConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取配置
   * @returns 当前配置
   */
  getConfig(): BackupConfig {
    return { ...this.config };
  }

  /**
   * 清理单个数据库的旧备份
   */
  private cleanupDatabase(name: string): CleanupResult {
    const backupDir = this.getDbBackupDir(name);
    if (!existsSync(backupDir)) {
      return { name, deletedCount: 0, remainingCount: 0, freedBytes: 0 };
    }

    const backups = this.listBackups(name);
    if (backups.length <= this.config.maxBackups) {
      return {
        name,
        deletedCount: 0,
        remainingCount: backups.length,
        freedBytes: 0,
      };
    }

    const toDelete = backups.slice(this.config.maxBackups);
    let freedBytes = 0;

    for (const file of toDelete) {
      try {
        const stats = statSync(file);
        freedBytes += stats.size;
        unlinkSync(file);
      } catch (error) {
        logger.warn(`删除旧备份失败: ${file}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info(`已清理 ${name} 的旧备份`, {
      deletedCount: toDelete.length,
      freedBytes,
    });

    return {
      name,
      deletedCount: toDelete.length,
      remainingCount: this.config.maxBackups,
      freedBytes,
    };
  }

  /**
   * 获取指定数据库的备份子目录
   */
  private getDbBackupDir(name: string): string {
    return join(resolve(this.config.backupDir), name);
  }

  /**
   * 记录备份到历史
   */
  private recordBackup(name: string, backupPath: string): void {
    if (!this.backupHistory.has(name)) {
      this.backupHistory.set(name, []);
    }
    this.backupHistory.get(name)!.push(backupPath);
  }

  /**
   * 判断是否需要备份
   */
  private shouldBackup(name: string): boolean {
    const backups = this.listBackups(name);
    if (backups.length === 0) {
      return true;
    }

    const latestBackup = backups[0];
    const latestMtime = statSync(latestBackup).mtimeMs;
    const now = Date.now();

    return now - latestMtime > this.config.backupIntervalMs;
  }
}

/**
 * 创建默认的 BackupManager 实例，注册项目已知的数据库
 * @param backupDir 备份目录（可选）
 * @returns 配置好的 BackupManager 实例
 */
export function createDefaultBackupManager(backupDir?: string): BackupManager {
  const manager = new BackupManager({
    backupDir: backupDir ?? getDefaultBackupDir(),
    enabled: true,
  });

  manager.registerDatabases([
    {
      name: 'app',
      dbPath: resolveDbPath(),
    },
  ]);

  return manager;
}
