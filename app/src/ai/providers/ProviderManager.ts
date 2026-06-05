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
 * 供应商管理器
 * 提供供应商（API Provider）的增删改查能力
 * 对标 CC 源码 cc-switch/src-tauri/src/provider.rs 实现
 */

import { Database } from 'sqlite3';
import { randomUUID } from 'node:crypto';
import { resolveDbPath } from '@modules/core/paths';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const logger = new Logger({ level: LogLevel.INFO });

/** 供应商类型 */
export type ProviderType =
  | 'openai'
  | 'deepseek'
  | 'anthropic'
  | 'google'
  | 'ollama'
  | 'moonshot'
  | 'grok'
  | 'bedrock'
  | 'vertex'
  | 'azure'
  | 'custom';

/** 供应商分类 */
export type ProviderCategory = 'official' | 'aggregator' | 'third_party' | 'cn_official';

/** 供应商记录 */
export interface ProviderRecord {
  /** 唯一ID */
  id: string;
  /** 供应商名称 */
  name: string;
  /** 供应商类型 */
  providerType: ProviderType;
  /** API基础URL */
  baseUrl: string;
  /** API密钥（已加密或从环境变量引用） */
  apiKey?: string;
  /** 模型列表URL覆盖 */
  modelsUrl?: string;
  /** 自定义请求头 */
  headers?: Record<string, string>;
  /** 是否激活 */
  isActive: boolean;
  /** 排序索引 */
  sortIndex: number;
  /** 备注 */
  notes?: string;
  /** 图标 */
  icon?: string;
  /** 图标颜色 */
  iconColor?: string;
  /** 是否需要认证（API Key） */
  requiresAuth: boolean;
  /** 供应商分类（官方、聚合、第三方、国内官方） */
  category?: ProviderCategory;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

/** 创建供应商参数 */
export interface CreateProviderParams {
  id?: string;
  name: string;
  providerType: ProviderType;
  baseUrl: string;
  apiKey?: string;
  modelsUrl?: string;
  headers?: Record<string, string>;
  isActive?: boolean;
  sortIndex?: number;
  notes?: string;
  icon?: string;
  iconColor?: string;
  requiresAuth?: boolean;
  category?: ProviderCategory;
}

/** 更新供应商参数 */
export interface UpdateProviderParams {
  name?: string;
  providerType?: ProviderType;
  baseUrl?: string;
  apiKey?: string;
  modelsUrl?: string;
  headers?: Record<string, string>;
  isActive?: boolean;
  sortIndex?: number;
  notes?: string;
  icon?: string;
  iconColor?: string;
  requiresAuth?: boolean;
  category?: ProviderCategory;
}

/** 供应商列表查询过滤器 */
export interface ProviderListFilter {
  providerType?: ProviderType;
  isActive?: boolean;
  search?: string;
}

const PROVIDERS_TABLE = 'ai_providers';

/**
 * 供应商管理器
 * 单例模式，基于 sqlite3 进行持久化存储
 */
export class ProviderManager {
  private static instance: ProviderManager;

  private db: Database | null = null;
  private dbPath: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  private constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  /** 获取单例 */
  static getInstance(dbPath?: string): ProviderManager {
    if (!ProviderManager.instance) {
      ProviderManager.instance = new ProviderManager(dbPath);
    }
    return ProviderManager.instance;
  }

  /** 初始化数据库连接和表 */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    try {
      this.db = await new Promise<Database>((resolve, reject) => {
        const db = new Database(this.dbPath, (err) => {
          if (err) reject(err);
          else resolve(db);
        });
      });

      await this.createTables();
      this.initialized = true;
      logger.info('ProviderManager 初始化完成');
    } catch (error) {
      logger.error('ProviderManager 初始化失败', error);
      throw new AppError(
        'Failed to initialize ProviderManager',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'PM_INIT_FAILED',
        { cause: error }
      );
    }
  }

  /** 创建数据表 */
  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.runAsync(`
      CREATE TABLE IF NOT EXISTS ${PROVIDERS_TABLE} (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key TEXT,
        models_url TEXT,
        headers TEXT DEFAULT '{}',
        is_active INTEGER NOT NULL DEFAULT 1,
        sort_index INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        icon TEXT,
        icon_color TEXT,
        category TEXT,
        requires_auth INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      )
    `);

    // 迁移：为已存在的 DB 添加 category 列（如果不存在）
    try {
      await this.runAsync(
        `ALTER TABLE ${PROVIDERS_TABLE} ADD COLUMN category TEXT`
      );
    } catch {
      // 列已存在，忽略
    }

    // 迁移：为已存在的 DB 添加 requires_auth 列（如果不存在）
    try {
      await this.runAsync(
        `ALTER TABLE ${PROVIDERS_TABLE} ADD COLUMN requires_auth INTEGER NOT NULL DEFAULT 1`
      );
    } catch {
      // 列已存在，忽略
    }

    await this.runAsync(`
      CREATE INDEX IF NOT EXISTS idx_ai_providers_type
      ON ${PROVIDERS_TABLE}(provider_type)
    `);

    await this.runAsync(`
      CREATE INDEX IF NOT EXISTS idx_ai_providers_active
      ON ${PROVIDERS_TABLE}(is_active)
    `);

    logger.info('providers 表创建/验证完成');
  }

  /** 执行 SQL run */
  private runAsync(sql: string, params?: unknown[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.db!.run(sql, params || [], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** 执行 SQL get */
  private getAsync<T>(sql: string, params?: unknown[]): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve, reject) => {
      this.db!.get(sql, params || [], (err, row) => {
        if (err) reject(err);
        else resolve(row as T | undefined);
      });
    });
  }

  /** 执行 SQL all */
  private allAsync<T>(sql: string, params?: unknown[]): Promise<T[]> {
    return new Promise<T[]>((resolve, reject) => {
      this.db!.all(sql, params || [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows as T[]);
      });
    });
  }

  /** 从数据库行映射到 ProviderRecord */
  private rowToProvider(row: Record<string, unknown>): ProviderRecord {
    return {
      id: row.id as string,
      name: row.name as string,
      providerType: row.provider_type as ProviderType,
      baseUrl: row.base_url as string,
      apiKey: row.api_key as string | undefined,
      modelsUrl: row.models_url as string | undefined,
      headers: (() => {
        try {
          const raw = row.headers as string;
          return raw ? JSON.parse(raw) : undefined;
        } catch {
          return undefined;
        }
      })(),
      isActive: (row.is_active as number) === 1,
      sortIndex: row.sort_index as number,
      notes: row.notes as string | undefined,
      icon: row.icon as string | undefined,
      iconColor: row.icon_color as string | undefined,
      requiresAuth: (row.requires_auth as number) === 1,
      category: row.category as ProviderCategory | undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  /** 初始化检查 */
  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new AppError(
        'ProviderManager not initialized. Call initialize() first.',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'PM_NOT_INITIALIZED'
      );
    }
  }

  // ─── CRUD 操作 ────────────────────────────────────────

  /** 获取所有供应商（支持过滤） */
  async listProviders(filter?: ProviderListFilter): Promise<ProviderRecord[]> {
    this.ensureInitialized();

    let sql = `SELECT * FROM ${PROVIDERS_TABLE} WHERE 1=1`;
    const params: unknown[] = [];

    if (filter?.providerType) {
      sql += ' AND provider_type = ?';
      params.push(filter.providerType);
    }

    if (filter?.isActive !== undefined) {
      sql += ' AND is_active = ?';
      params.push(filter.isActive ? 1 : 0);
    }

    if (filter?.search) {
      sql += ' AND (name LIKE ? OR notes LIKE ?)';
      const pattern = `%${filter.search}%`;
      params.push(pattern, pattern);
    }

    sql += ' ORDER BY sort_index ASC, name ASC';

    const rows = await this.allAsync<Record<string, unknown>>(sql, params);
    return rows.map((r) => this.rowToProvider(r));
  }

  /** 获取单个供应商 */
  async getProvider(id: string): Promise<ProviderRecord | undefined> {
    this.ensureInitialized();

    const row = await this.getAsync<Record<string, unknown>>(
      `SELECT * FROM ${PROVIDERS_TABLE} WHERE id = ?`,
      [id]
    );
    return row ? this.rowToProvider(row) : undefined;
  }

  /** 创建供应商 */
  async createProvider(params: CreateProviderParams): Promise<ProviderRecord> {
    this.ensureInitialized();

    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);

    await this.runAsync(
      `INSERT INTO ${PROVIDERS_TABLE}
       (id, name, provider_type, base_url, api_key, models_url, headers, is_active, sort_index, requires_auth, notes, icon, icon_color, category, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.name,
        params.providerType,
        params.baseUrl,
        params.apiKey || null,
        params.modelsUrl || null,
        JSON.stringify(params.headers || {}),
        params.requiresAuth !== false ? 1 : 0,
        params.notes || null,
        params.icon || null,
        params.iconColor || null,
        params.category || null,
        now,
        now,
      ]
    );

    logger.info(`供应商已创建: ${params.name} (${id})`);
    return (await this.getProvider(id))!;
  }

  /** 更新供应商 */
  async updateProvider(
    id: string,
    params: UpdateProviderParams
  ): Promise<ProviderRecord | undefined> {
    this.ensureInitialized();

    const existing = await this.getProvider(id);
    if (!existing) {
      return undefined;
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    const now = Math.floor(Date.now() / 1000);

    if (params.name !== undefined) {
      fields.push('name = ?');
      values.push(params.name);
    }
    if (params.providerType !== undefined) {
      fields.push('provider_type = ?');
      values.push(params.providerType);
    }
    if (params.baseUrl !== undefined) {
      fields.push('base_url = ?');
      values.push(params.baseUrl);
    }
    if (params.apiKey !== undefined) {
      fields.push('api_key = ?');
      values.push(params.apiKey || null);
    }
    if (params.modelsUrl !== undefined) {
      fields.push('models_url = ?');
      values.push(params.modelsUrl || null);
    }
    if (params.headers !== undefined) {
      fields.push('headers = ?');
      values.push(JSON.stringify(params.headers));
    }
    if (params.isActive !== undefined) {
      fields.push('is_active = ?');
      values.push(params.isActive ? 1 : 0);
    }
    if (params.sortIndex !== undefined) {
      fields.push('sort_index = ?');
      values.push(params.sortIndex);
    }
    if (params.notes !== undefined) {
      fields.push('notes = ?');
      values.push(params.notes || null);
    }
    if (params.icon !== undefined) {
      fields.push('icon = ?');
      values.push(params.icon || null);
    }
    if (params.iconColor !== undefined) {
      fields.push('icon_color = ?');
      values.push(params.iconColor || null);
    }
    if (params.requiresAuth !== undefined) {
      fields.push('requires_auth = ?');
      values.push(params.requiresAuth ? 1 : 0);
    }
    if (params.category !== undefined) {
      fields.push('category = ?');
      values.push(params.category || null);
    }

    if (fields.length === 0) {
      return existing;
    }

    fields.push('updated_at = ?');
    values.push(now);
    values.push(id);

    await this.runAsync(
      `UPDATE ${PROVIDERS_TABLE} SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    logger.info(`供应商已更新: ${id}`);
    return this.getProvider(id);
  }

  /** 删除供应商 */
  async deleteProvider(id: string): Promise<boolean> {
    this.ensureInitialized();

    const existing = await this.getProvider(id);
    if (!existing) {
      return false;
    }

    await this.runAsync(`DELETE FROM ${PROVIDERS_TABLE} WHERE id = ?`, [id]);

    logger.info(`供应商已删除: ${existing.name} (${id})`);
    return true;
  }

  /** 激活/停用供应商 */
  async toggleProvider(
    id: string,
    active: boolean
  ): Promise<ProviderRecord | undefined> {
    return this.updateProvider(id, { isActive: active });
  }

  /** 设置供应商排序 */
  async setSortOrder(
    id: string,
    sortIndex: number
  ): Promise<ProviderRecord | undefined> {
    return this.updateProvider(id, { sortIndex });
  }

  /** 获取按类型分组的供应商统计 */
  async getProviderStats(): Promise<
    { type: string; count: number; active: number }[]
  > {
    this.ensureInitialized();

    const rows = await this.allAsync<{
      provider_type: string;
      count: number;
      active: number;
    }>(
      `SELECT provider_type, COUNT(*) as count,
         SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active
       FROM ${PROVIDERS_TABLE}
       GROUP BY provider_type
       ORDER BY count DESC`
    );

    return rows.map((r) => ({
      type: r.provider_type,
      count: r.count,
      active: r.active,
    }));
  }
}

/** 导出单例 */
export const providerManager = ProviderManager.getInstance();
