/**
 * 状态迁移管理器
 * 参考CC源码的状态管理模式，提供版本化的状态迁移机制
 * 包括：迁移注册、版本检查、迁移执行、回滚支持
 */

import { logger } from '@modules/utils/log.js';

/**
 * 迁移函数类型
 */
export type MigrationFn = (state: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;

/**
 * 迁移定义
 */
export interface Migration {
  /** 迁移版本号 */
  version: number;
  /** 迁移描述 */
  description: string;
  /** 迁移函数 */
  migrate: MigrationFn;
  /** 回滚函数（可选） */
  rollback?: MigrationFn;
}

/**
 * 迁移结果
 */
export interface MigrationResult {
  /** 是否成功 */
  success: boolean;
  /** 从版本 */
  fromVersion: number;
  /** 到版本 */
  toVersion: number;
  /** 迁移的状态 */
  state?: Record<string, unknown>;
  /** 错误信息 */
  error?: string;
}

/**
 * 状态元数据
 */
export interface StateMetadata {
  /** 状态版本 */
  version: number;
  /** 创建时间 */
  createdAt: number;
  /** 最后更新时间 */
  updatedAt: number;
  /** 迁移历史 */
  migrationHistory: MigrationRecord[];
}

/**
 * 迁移记录
 */
export interface MigrationRecord {
  /** 迁移版本 */
  version: number;
  /** 迁移时间 */
  migratedAt: number;
  /** 迁移描述 */
  description: string;
  /** 是否成功 */
  success: boolean;
}

/**
 * 状态迁移管理器
 */
export class StateMigrator {
  private static instance: StateMigrator;
  private migrations: Map<number, Migration>;
  private currentVersion: number;
  private targetVersion: number;

  private constructor() {
    this.migrations = new Map();
    this.currentVersion = 0;
    this.targetVersion = 0;
  }

  /**
   * 获取单例实例
   */
  static getInstance(): StateMigrator {
    if (!StateMigrator.instance) {
      StateMigrator.instance = new StateMigrator();
    }
    return StateMigrator.instance;
  }

  /**
   * 注册迁移
   * @param migration 迁移定义
   */
  registerMigration(migration: Migration): void {
    if (this.migrations.has(migration.version)) {
      throw new Error(`Migration version ${migration.version} already registered`);
    }

    this.migrations.set(migration.version, migration);
    this.targetVersion = Math.max(this.targetVersion, migration.version);
    logger.debug(`Registered migration v${migration.version}: ${migration.description}`);
  }

  /**
   * 批量注册迁移
   * @param migrations 迁移定义数组
   */
  registerMigrations(migrations: Migration[]): void {
    for (const migration of migrations) {
      this.registerMigration(migration);
    }
  }

  /**
   * 获取当前版本
   */
  getCurrentVersion(): number {
    return this.currentVersion;
  }

  /**
   * 获取目标版本
   */
  getTargetVersion(): number {
    return this.targetVersion;
  }

  /**
   * 检查是否需要迁移
   * @param stateMetadata 状态元数据
   */
  needsMigration(stateMetadata?: StateMetadata): boolean {
    const version = stateMetadata?.version ?? 0;
    return version < this.targetVersion;
  }

  /**
   * 执行迁移
   * @param state 当前状态
   * @param stateMetadata 状态元数据（可选）
   */
  async migrate(state: any, stateMetadata?: StateMetadata): Promise<MigrationResult> {
    const fromVersion = stateMetadata?.version ?? 0;
    const toVersion = this.targetVersion;

    if (fromVersion >= toVersion) {
      logger.info(`No migration needed (current: v${fromVersion}, target: v${toVersion})`);
      return {
        success: true,
        fromVersion,
        toVersion: fromVersion,
        state,
      };
    }

    logger.info(`Starting migration: v${fromVersion} -> v${toVersion}`);
    let currentState = state;
    
    // 确保migrationHistory存在
    if (stateMetadata && !stateMetadata.migrationHistory) {
      stateMetadata.migrationHistory = [];
    }
    const migrationHistory = stateMetadata?.migrationHistory ?? [];

    try {
      // 按版本顺序执行迁移
      for (let version = fromVersion + 1; version <= toVersion; version++) {
        const migration = this.migrations.get(version);
        
        if (!migration) {
          throw new Error(`Migration v${version} not found`);
        }

        logger.info(`Executing migration v${version}: ${migration.description}`);
        
        try {
          currentState = await migration.migrate(currentState);
          
          // 记录迁移历史
          migrationHistory.push({
            version,
            migratedAt: Date.now(),
            description: migration.description,
            success: true,
          });

          logger.info(`Migration v${version} completed successfully`);
        } catch (error) {
          logger.error(`Migration v${version} failed:`, error as Error);
          
          // 记录失败的迁移
          migrationHistory.push({
            version,
            migratedAt: Date.now(),
            description: migration.description,
            success: false,
          });

          // 尝试回滚
          if (migration.rollback) {
            logger.info(`Attempting rollback for v${version}`);
            try {
              currentState = await migration.rollback(currentState);
              logger.info(`Rollback v${version} completed`);
            } catch (rollbackError) {
              logger.error(`Rollback v${version} failed:`, rollbackError as Error);
            }
          }

          return {
            success: false,
            fromVersion,
            toVersion: version - 1,
            state: currentState,
            error: `Migration v${version} failed: ${(error as Error).message}`,
          };
        }
      }

      // 所有迁移成功完成
      this.currentVersion = toVersion;
      
      // 更新元数据
      if (stateMetadata) {
        stateMetadata.version = toVersion;
        stateMetadata.updatedAt = Date.now();
      }
      
      logger.info(`Migration completed: v${fromVersion} -> v${toVersion}`);

      return {
        success: true,
        fromVersion,
        toVersion,
        state: currentState,
      };
    } catch (error) {
      logger.error('Migration process failed:', error as Error);
      return {
        success: false,
        fromVersion,
        toVersion: this.currentVersion,
        state: currentState,
        error: (error as Error).message,
      };
    }
  }

  /**
   * 创建状态元数据
   */
  createMetadata(): StateMetadata {
    return {
      version: this.targetVersion,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      migrationHistory: [],
    };
  }

  /**
   * 更新状态元数据
   * @param metadata 现有元数据
   * @param result 迁移结果
   */
  updateMetadata(metadata: StateMetadata, result: MigrationResult): StateMetadata {
    return {
      ...metadata,
      version: result.toVersion,
      updatedAt: Date.now(),
      migrationHistory: result.state ? metadata.migrationHistory : metadata.migrationHistory,
    };
  }

  /**
   * 获取已注册的迁移列表
   */
  getRegisteredMigrations(): Migration[] {
    return Array.from(this.migrations.values()).sort((a, b) => a.version - b.version);
  }

  /**
   * 重置迁移器（主要用于测试）
   */
  reset(): void {
    this.migrations.clear();
    this.currentVersion = 0;
    this.targetVersion = 0;
  }
}

/**
 * 便捷函数：创建状态元数据
 */
export function createStateMetadata(): StateMetadata {
  return StateMigrator.getInstance().createMetadata();
}

/**
 * 便捷函数：执行状态迁移
 * @param state 当前状态
 * @param metadata 状态元数据
 */
export async function migrateState(state: any, metadata?: StateMetadata): Promise<MigrationResult> {
  return StateMigrator.getInstance().migrate(state, metadata);
}
