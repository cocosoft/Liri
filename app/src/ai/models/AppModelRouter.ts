// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 应用模型路由配置
 *
 * 支持 per-app 模型配置：不同的应用类型（CLI/API/Agent/Tool/Plugin）可以使用不同的模型。
 * 对标 CC 源码 cc-switch/src-tauri/src/app_config.rs (AppType)
 */

import { Database } from 'sqlite3';
import { resolveDbPath, ensureDir } from '@modules/core/paths';
import { dirname } from 'path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const logger = new Logger({ level: LogLevel.INFO });

const APP_CONFIG_TABLE = 'ai_app_model_configs';

/** 应用类型 */
export type AppModelTarget =
  | 'cli'
  | 'api'
  | 'agent'
  | 'tool'
  | 'plugin'
  | 'default';

/** 应用模型配置记录 */
export interface AppModelConfig {
  /** 应用类型标识 */
  appType: string;
  /** 当前使用的模型ID */
  model: string;
  /** 当前使用的供应商ID */
  providerId?: string;
  /** 降级模型ID */
  fallbackModel?: string;
  /** 降级供应商ID */
  fallbackProviderId?: string;
  /** 更新时间 */
  updatedAt: number;
}

/**
 * 应用模型路由器
 *
 * 单例服务，管理不同应用类型的模型选择。
 * 数据持久化到 app.db 的 ai_app_model_configs 表。
 */
export class AppModelRouter {
  private static instance: AppModelRouter;

  private db: Database | null = null;
  private dbPath: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  /** 内存缓存 */
  private cache: Map<string, AppModelConfig> = new Map();

  private constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  static getInstance(dbPath?: string): AppModelRouter {
    if (!AppModelRouter.instance) {
      AppModelRouter.instance = new AppModelRouter(dbPath);
    }
    return AppModelRouter.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    try {
      // 确保数据库文件所在目录存在
      const dir = dirname(this.dbPath);
      ensureDir(dir);
      logger.debug('AppModelRouter DB 目录', { dir, dbPath: this.dbPath });

      this.db = await new Promise<Database>((resolve, reject) => {
        const db = new Database(this.dbPath, (err) => {
          if (err) reject(err);
          else resolve(db);
        });
      });

      await this.createTable();
      // 先标记已初始化，再调用 ensureDefaultEntry（内部需要 getConfig）
      this.initialized = true;
      await this.ensureDefaultEntry();
      logger.info('AppModelRouter 初始化完成');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('AppModelRouter 初始化失败', { dbPath: this.dbPath, error: msg });
      throw new AppError(
        `Failed to initialize AppModelRouter: ${msg}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'AMR_INIT_FAILED',
        { cause: error }
      );
    }
  }

  private async createTable(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `
        CREATE TABLE IF NOT EXISTS ${APP_CONFIG_TABLE} (
          app_type TEXT PRIMARY KEY,
          model TEXT NOT NULL DEFAULT '',
          provider_id TEXT,
          fallback_model TEXT,
          fallback_provider_id TEXT,
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )
      `,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    logger.info('ai_app_model_configs 表创建/验证完成');
  }

  private async ensureDefaultEntry(): Promise<void> {
    const existing = await this.getConfig('default');
    if (existing && existing.model) return;

    // 从 ActiveModelProvider 获取第一个可用模型
    const { activeModelProvider } = await import('./ActiveModelProvider.js');
    const effectiveModel = await activeModelProvider.getEffectiveModel(undefined, 'ollama');
    const modelId = effectiveModel || '';

    await this.setConfig('default', { model: modelId });
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new AppError(
        'AppModelRouter not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'AMR_NOT_INIT'
      );
    }
  }

  /** 获取指定应用类型的模型配置 */
  async getConfig(appType: string): Promise<AppModelConfig | undefined> {
    this.ensureInitialized();

    // 先查缓存
    const cached = this.cache.get(appType);
    if (cached) return cached;

    return new Promise<AppModelConfig | undefined>((resolve, reject) => {
      this.db!.get(
        `SELECT * FROM ${APP_CONFIG_TABLE} WHERE app_type = ?`,
        [appType],
        (err, row) => {
          if (err) reject(err);
          else if (!row) resolve(undefined);
          else {
            const r = row as Record<string, unknown>;
            const config: AppModelConfig = {
              appType: r.app_type as string,
              model: r.model as string,
              providerId: r.provider_id as string | undefined,
              fallbackModel: r.fallback_model as string | undefined,
              fallbackProviderId: r.fallback_provider_id as string | undefined,
              updatedAt: r.updated_at as number,
            };
            this.cache.set(appType, config);
            resolve(config);
          }
        }
      );
    });
  }

  /** 获取模型：先查应用配置，再回退 default */
  async getModel(appType: string): Promise<string> {
    const config = await this.getConfig(appType);
    if (config?.model) return config.model;

    const defaultConfig = await this.getConfig('default');
    return defaultConfig?.model || '';
  }

  /** 获取供应商ID：先查应用配置，再回退 default */
  async getProviderId(appType: string): Promise<string | undefined> {
    const config = await this.getConfig(appType);
    if (config?.providerId) return config.providerId;

    const defaultConfig = await this.getConfig('default');
    return defaultConfig?.providerId;
  }

  /** 设置指定应用类型的模型配置 */
  async setConfig(
    appType: string,
    params: {
      model?: string;
      providerId?: string;
      fallbackModel?: string;
      fallbackProviderId?: string;
    }
  ): Promise<AppModelConfig> {
    this.ensureInitialized();

    const now = Math.floor(Date.now() / 1000);
    const existing = await this.getConfig(appType);

    if (existing) {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `UPDATE ${APP_CONFIG_TABLE} SET
           model = ?, provider_id = ?, fallback_model = ?, fallback_provider_id = ?, updated_at = ?
           WHERE app_type = ?`,
          [
            params.model ?? existing.model,
            params.providerId ?? existing.providerId ?? null,
            params.fallbackModel ?? existing.fallbackModel ?? null,
            params.fallbackProviderId ?? existing.fallbackProviderId ?? null,
            now,
            appType,
          ],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    } else {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `INSERT INTO ${APP_CONFIG_TABLE}
           (app_type, model, provider_id, fallback_model, fallback_provider_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            appType,
            params.model || '',
            params.providerId || null,
            params.fallbackModel || null,
            params.fallbackProviderId || null,
            now,
          ],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    }

    // 使缓存失效
    this.cache.delete(appType);

    return (await this.getConfig(appType))!;
  }

  /** 获取所有应用配置 */
  async getAllConfigs(): Promise<AppModelConfig[]> {
    this.ensureInitialized();

    return new Promise<AppModelConfig[]>((resolve, reject) => {
      this.db!.all(
        `SELECT * FROM ${APP_CONFIG_TABLE} ORDER BY app_type ASC`,
        (err, rows) => {
          if (err) reject(err);
          else {
            resolve(
              (rows as Record<string, unknown>[]).map((r) => ({
                appType: r.app_type as string,
                model: r.model as string,
                providerId: r.provider_id as string | undefined,
                fallbackModel: r.fallback_model as string | undefined,
                fallbackProviderId: r.fallback_provider_id as
                  | string
                  | undefined,
                updatedAt: r.updated_at as number,
              }))
            );
          }
        }
      );
    });
  }

  /** 删除指定应用配置（不允许删除 default） */
  async deleteConfig(appType: string): Promise<boolean> {
    if (appType === 'default') {
      throw new AppError(
        'Cannot delete default config',
        ErrorCategory.EXECUTION,
        ErrorSeverity.MEDIUM,
        'AMR_NO_DELETE_DEFAULT'
      );
    }

    this.ensureInitialized();

    return new Promise<boolean>((resolve, reject) => {
      this.db!.run(
        `DELETE FROM ${APP_CONFIG_TABLE} WHERE app_type = ?`,
        [appType],
        function (err) {
          if (err) reject(err);
          else {
            if (this.changes > 0) {
              AppModelRouter.instance?.cache.delete(appType);
            }
            resolve(this.changes > 0);
          }
        }
      );
    });
  }
}

export const appModelRouter = AppModelRouter.getInstance();
