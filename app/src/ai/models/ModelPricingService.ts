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
 * 模型定价管理服务
 * 对标 CC 源码 cc-switch/src-tauri/src/commands/usage.rs (model_pricing 表)
 *
 * 提供基于 SQLite 的模型定价存储和查询，
 * 与 ModelRegistry（YAML 驱动）互补：DB 为可编辑用户定价，YAML 为只读默认值。
 */

import { Database } from 'sqlite3';
import { randomUUID } from 'node:crypto';
import { resolveDbPath } from '@modules/config/paths';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const logger = new Logger({ level: LogLevel.INFO });

const PRICING_TABLE = 'model_pricing';

/** 模型定价记录 */
export interface ModelPricingRecord {
  id: string;
  modelId: string;
  displayName: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  cacheReadCostPerMillion: number;
  cacheWriteCostPerMillion: number;
  isCustom: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 创建/更新定价参数 */
export interface UpsertPricingParams {
  modelId: string;
  displayName?: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  cacheReadCostPerMillion?: number;
  cacheWriteCostPerMillion?: number;
}

/**
 * 模型定价管理服务
 */
export class ModelPricingService {
  private static instance: ModelPricingService;

  private db: Database | null = null;
  private dbPath: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  private constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  static getInstance(dbPath?: string): ModelPricingService {
    if (!ModelPricingService.instance) {
      ModelPricingService.instance = new ModelPricingService(dbPath);
    }
    return ModelPricingService.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

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

      await this.createTable();
      this.initialized = true;
      logger.info('ModelPricingService 初始化完成');
    } catch (error) {
      logger.error('ModelPricingService 初始化失败', error);
      throw new AppError(
        'Failed to initialize ModelPricingService',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'PRICING_INIT_FAILED',
        { cause: error },
      );
    }
  }

  private async createTable(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.db!.run(`
        CREATE TABLE IF NOT EXISTS ${PRICING_TABLE} (
          id TEXT PRIMARY KEY,
          model_id TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL DEFAULT '',
          input_cost_per_million REAL NOT NULL DEFAULT 0,
          output_cost_per_million REAL NOT NULL DEFAULT 0,
          cache_read_cost_per_million REAL NOT NULL DEFAULT 0,
          cache_write_cost_per_million REAL NOT NULL DEFAULT 0,
          is_custom INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )
      `, (err) => {
        if (err) reject(err);
        else {
          this.db!.run(
            `CREATE INDEX IF NOT EXISTS idx_model_pricing_model_id ON ${PRICING_TABLE}(model_id)`,
            (err2) => { if (err2) reject(err2); else resolve(); },
          );
        }
      });
    });

    logger.info('model_pricing 表创建/验证完成');
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new AppError(
        'ModelPricingService not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'PRICING_NOT_INIT',
      );
    }
  }

  /** 获取或更新模型定价 */
  async upsertPricing(params: UpsertPricingParams): Promise<ModelPricingRecord> {
    this.ensureInitialized();

    const now = Math.floor(Date.now() / 1000);
    const existing = await this.getPricing(params.modelId);

    if (existing) {
      // 更新
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `UPDATE ${PRICING_TABLE} SET
           display_name = ?,
           input_cost_per_million = ?,
           output_cost_per_million = ?,
           cache_read_cost_per_million = ?,
           cache_write_cost_per_million = ?,
           is_custom = 1,
           updated_at = ?
           WHERE model_id = ?`,
          [
            params.displayName || existing.displayName,
            params.inputCostPerMillion,
            params.outputCostPerMillion,
            params.cacheReadCostPerMillion || 0,
            params.cacheWriteCostPerMillion || 0,
            now,
            params.modelId,
          ],
          (err) => {
            if (err) reject(err);
            else resolve();
          },
        );
      });
    } else {
      // 插入
      const id = randomUUID();
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `INSERT INTO ${PRICING_TABLE}
           (id, model_id, display_name, input_cost_per_million, output_cost_per_million,
            cache_read_cost_per_million, cache_write_cost_per_million, is_custom, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [
            id,
            params.modelId,
            params.displayName || params.modelId,
            params.inputCostPerMillion,
            params.outputCostPerMillion,
            params.cacheReadCostPerMillion || 0,
            params.cacheWriteCostPerMillion || 0,
            now,
            now,
          ],
          (err) => {
            if (err) reject(err);
            else resolve();
          },
        );
      });
    }

    return (await this.getPricing(params.modelId))!;
  }

  /** 获取单个模型定价 */
  async getPricing(modelId: string): Promise<ModelPricingRecord | undefined> {
    this.ensureInitialized();

    return new Promise<ModelPricingRecord | undefined>((resolve, reject) => {
      this.db!.get(
        `SELECT * FROM ${PRICING_TABLE} WHERE model_id = ?`,
        [modelId],
        (err, row) => {
          if (err) reject(err);
          else if (!row) resolve(undefined);
          else {
            const r = row as Record<string, unknown>;
            resolve({
              id: r.id as string,
              modelId: r.model_id as string,
              displayName: r.display_name as string,
              inputCostPerMillion: r.input_cost_per_million as number,
              outputCostPerMillion: r.output_cost_per_million as number,
              cacheReadCostPerMillion: r.cache_read_cost_per_million as number,
              cacheWriteCostPerMillion: r.cache_write_cost_per_million as number,
              isCustom: (r.is_custom as number) === 1,
              createdAt: r.created_at as number,
              updatedAt: r.updated_at as number,
            });
          }
        },
      );
    });
  }

  /** 获取所有定价 */
  async getAllPricing(): Promise<ModelPricingRecord[]> {
    this.ensureInitialized();

    return new Promise<ModelPricingRecord[]>((resolve, reject) => {
      this.db!.all(
        `SELECT * FROM ${PRICING_TABLE} ORDER BY model_id ASC`,
        (err, rows) => {
          if (err) reject(err);
          else {
            resolve(
              (rows as Record<string, unknown>[]).map((r) => ({
                id: r.id as string,
                modelId: r.model_id as string,
                displayName: r.display_name as string,
                inputCostPerMillion: r.input_cost_per_million as number,
                outputCostPerMillion: r.output_cost_per_million as number,
                cacheReadCostPerMillion: r.cache_read_cost_per_million as number,
                cacheWriteCostPerMillion: r.cache_write_cost_per_million as number,
                isCustom: (r.is_custom as number) === 1,
                createdAt: r.created_at as number,
                updatedAt: r.updated_at as number,
              })),
            );
          }
        },
      );
    });
  }

  /** 删除自定义定价 */
  async deletePricing(modelId: string): Promise<boolean> {
    this.ensureInitialized();

    return new Promise<boolean>((resolve, reject) => {
      this.db!.run(
        `DELETE FROM ${PRICING_TABLE} WHERE model_id = ? AND is_custom = 1`,
        [modelId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes > 0);
        },
      );
    });
  }
}

export const modelPricingService = ModelPricingService.getInstance();
