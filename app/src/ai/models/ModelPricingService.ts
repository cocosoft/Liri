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
 * 模型注册表服务（单一数据源）
 *
 * 统一管理模型定义 + 定价 + 启停状态，数据存储于 model_registry 表。
 * 启动时从 models.default.yaml 种子到 DB（首次/表空时），此后所有读写均以 DB 为准。
 *
 * 旧 model_pricing 表在首次初始化时自动迁移并废弃。
 *
 * 使用方式:
 *   import { modelPricingService } from './ModelPricingService.js';
 *   await modelPricingService.initialize();
 *   const pricing = await modelPricingService.getPricing('gpt-4o');
 */

import { Database } from '@modules/core/external/sqlite3';
import { randomUUID } from 'crypto';
import { resolveDbPath } from '@modules/core';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

const logger = new Logger({ level: LogLevel.INFO, module: 'ai:pricing' });

const REGISTRY_TABLE = 'model_registry';
const OLD_PRICING_TABLE = 'model_pricing';

/** 数据库行原始列名 → 接口字段名映射 */
const COLUMN_MAP: Record<string, string> = {
  model_id: 'modelId',
  display_name: 'displayName',
  context_window: 'contextWindow',
  max_output_tokens: 'maxOutputTokens',
  input_price: 'inputCostPerMillion',
  output_price: 'outputCostPerMillion',
  cache_read_price: 'cacheReadCostPerMillion',
  cache_write_price: 'cacheWriteCostPerMillion',
  cost_multiplier: 'costMultiplier',
  pricing_source: 'pricingSource',
  is_custom: 'isCustom',
  provider_id: 'providerId',
  provider_mappings: 'providerMappings',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
};

/** 模型注册表记录（完整字段） */
export interface ModelPricingRecord {
  id: string;
  modelId: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: string[];
  /** JSON: {"firstParty":"gpt-4o","openai":"gpt-4o"} */
  providerMappings: Record<string, string>;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  cacheReadCostPerMillion: number;
  cacheWriteCostPerMillion: number;
  costMultiplier: number;
  pricingSource: string;
  isCustom: boolean;
  providerId: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 创建/更新模型参数 */
export interface UpsertPricingParams {
  modelId: string;
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilities?: string[];
  providerMappings?: Record<string, string>;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  cacheReadCostPerMillion?: number;
  cacheWriteCostPerMillion?: number;
  costMultiplier?: number;
  pricingSource?: string;
  providerId?: string;
  enabled?: boolean;
}

/** 将数据库行转为 ModelPricingRecord */
function rowToRecord(row: Record<string, unknown>): ModelPricingRecord {
  let capabilities: string[] = [];
  try {
    const raw = row.capabilities as string;
    if (raw) capabilities = JSON.parse(raw);
  } catch (err) {
    /* 静默忽略 */
  }

  let providerMappings: Record<string, string> = {};
  try {
    const raw = row.provider_mappings as string;
    if (raw) providerMappings = JSON.parse(raw);
  } catch (err) {
    /* 静默忽略 */
  }

  return {
    id: row.id as string,
    modelId: row.model_id as string,
    displayName: row.display_name as string,
    contextWindow: (row.context_window as number) || 128000,
    maxOutputTokens: (row.max_output_tokens as number) || 8192,
    capabilities,
    providerMappings,
    inputCostPerMillion: (row.input_price as number) || 0,
    outputCostPerMillion: (row.output_price as number) || 0,
    cacheReadCostPerMillion: (row.cache_read_price as number) || 0,
    cacheWriteCostPerMillion: (row.cache_write_price as number) || 0,
    costMultiplier: (row.cost_multiplier as number) ?? 1.0,
    pricingSource: (row.pricing_source as string) || 'default',
    isCustom: (row.is_custom as number) === 1,
    providerId: (row.provider_id as string) || '',
    enabled: (row.enabled as number) !== 0,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

/**
 * 模型注册表服务（单一数据源）
 *
 * 所有模型数据（定义、定价、启停）统一由 model_registry 表管理。
 * YAML 仅在首次启动时作为种子数据写入，之后所有读写以 DB 为准。
 */
export class ModelPricingService {
  private static instance: ModelPricingService;

  private db: Database | null = null;
  private dbPath: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private seeded = false;

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

  /** 是否已经从 YAML 种过数据 */
  isSeeded(): boolean {
    return this.seeded;
  }

  private async _doInitialize(): Promise<void> {
    try {
      this.db = await new Promise<Database>((resolve, reject) => {
        const db = new Database(this.dbPath, (err: Error | null) => {
          if (err) reject(err);
          else resolve(db);
        });
      });

      await this.createRegistryTable();
      await this.migrateOldPricingTable();
      await this.seedFromYamlIfEmpty();
      await this.migrateBackfillUUIDs();

      this.initialized = true;
      logger.info(
        'ModelPricingService 初始化完成（model_registry 单一数据源）'
      );
    } catch (error) {
      await handleError(error, { module: 'ai:pricing', action: 'initialize' });
      throw new AppError(
        'Failed to initialize ModelPricingService',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'PRICING_INIT_FAILED',
        { cause: error }
      );
    }
  }

  private async createRegistryTable(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `CREATE TABLE IF NOT EXISTS ${REGISTRY_TABLE} (
          id                 TEXT NOT NULL DEFAULT '',
          model_id           TEXT PRIMARY KEY,
          display_name       TEXT NOT NULL DEFAULT '',
          context_window     INTEGER NOT NULL DEFAULT 128000,
          max_output_tokens  INTEGER NOT NULL DEFAULT 8192,
          capabilities       TEXT NOT NULL DEFAULT '[]',
          provider_mappings  TEXT NOT NULL DEFAULT '{}',
          input_price        REAL NOT NULL DEFAULT 0,
          output_price       REAL NOT NULL DEFAULT 0,
          cache_read_price   REAL NOT NULL DEFAULT 0,
          cache_write_price  REAL NOT NULL DEFAULT 0,
          cost_multiplier    REAL NOT NULL DEFAULT 1.0,
          pricing_source     TEXT NOT NULL DEFAULT 'default',
          provider_id        TEXT NOT NULL DEFAULT '',
          enabled            INTEGER NOT NULL DEFAULT 1,
          is_custom          INTEGER NOT NULL DEFAULT 0,
          created_at         INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          updated_at         INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        )`,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // 兼容旧列：尝试添加可能缺失的 is_custom 列（已存在的库）
    await new Promise<void>((resolve) => {
      this.db!.run(
        `ALTER TABLE ${REGISTRY_TABLE} ADD COLUMN is_custom INTEGER NOT NULL DEFAULT 0`,
        () => resolve()
      );
    });

    // 兼容旧列：尝试添加可能缺失的 id 列（已存在的库）
    await new Promise<void>((resolve) => {
      this.db!.run(
        `ALTER TABLE ${REGISTRY_TABLE} ADD COLUMN id TEXT NOT NULL DEFAULT ''`,
        () => resolve()
      );
    });

    // 兼容旧列：尝试添加可能缺失的 cost_multiplier 列（已存在的库）
    await new Promise<void>((resolve) => {
      this.db!.run(
        `ALTER TABLE ${REGISTRY_TABLE} ADD COLUMN cost_multiplier REAL NOT NULL DEFAULT 1.0`,
        () => resolve()
      );
    });

    // 兼容旧列：尝试添加可能缺失的 pricing_source 列（已存在的库）
    await new Promise<void>((resolve) => {
      this.db!.run(
        `ALTER TABLE ${REGISTRY_TABLE} ADD COLUMN pricing_source TEXT NOT NULL DEFAULT 'default'`,
        () => resolve()
      );
    });

    // UUID 唯一索引（仅非空值）
    await new Promise<void>((resolve) => {
      this.db!.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_model_registry_id ON ${REGISTRY_TABLE}(id) WHERE id IS NOT NULL AND id != ''`,
        () => resolve()
      );
    });

    logger.info('model_registry 表创建/验证完成');
  }

  /** Promise 化 db.run */
  private runAsync(sql: string, params: any[] = []): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.db!.run(sql, params, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** 为存量记录回填 UUID（事务包裹，避免逐条 COMMIT） */
  private async migrateBackfillUUIDs(): Promise<void> {
    const rows = await new Promise<{ model_id: string }[]>(
      (resolve, reject) => {
        this.db!.all(
          `SELECT model_id FROM ${REGISTRY_TABLE} WHERE id = '' OR id IS NULL`,
          (err: Error | null, rows: any[]) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      }
    );

    if (rows.length === 0) return;

    logger.info(`开始为 ${rows.length} 条模型记录回填 UUID`);
    await this.runAsync('BEGIN TRANSACTION');
    try {
      for (const row of rows) {
        await this.runAsync(
          `UPDATE ${REGISTRY_TABLE} SET id = ? WHERE model_id = ?`,
          [randomUUID(), row.model_id]
        );
      }
      await this.runAsync('COMMIT');
      logger.info(`已完成 ${rows.length} 条模型记录 UUID 回填`);
    } catch (err) {
      // @ignore-catch — ROLLBACK失败不影响已抛出的原始异常
      await this.runAsync('ROLLBACK').catch(() => {});
      throw err;
    }
  }

  /** 迁移旧 model_pricing 表数据到 model_registry，然后删除旧表 */
  private async migrateOldPricingTable(): Promise<void> {
    // 检查旧表是否存在
    const tableExists = await new Promise<boolean>((resolve, reject) => {
      this.db!.get(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
        [OLD_PRICING_TABLE],
        (err: Error | null, row: any) => {
          if (err) reject(err);
          else resolve(!!row);
        }
      );
    });

    if (!tableExists) return;

    // 检查 model_registry 是否已有数据（避免重复迁移）
    const registryCount = await new Promise<number>((resolve, reject) => {
      this.db!.get(
        `SELECT COUNT(*) as cnt FROM ${REGISTRY_TABLE}`,
        (err: Error | null, row: any) => {
          if (err) reject(err);
          else resolve((row as Record<string, number>).cnt);
        }
      );
    });

    if (registryCount > 0) {
      // 已有数据，直接删旧表
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `DROP TABLE IF EXISTS ${OLD_PRICING_TABLE}`,
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
      logger.info('旧 model_pricing 表已废弃并删除（新表已有数据）');
      return;
    }

    // 迁移数据
    const oldRows = await new Promise<Record<string, unknown>[]>(
      (resolve, reject) => {
        this.db!.all(
          `SELECT * FROM ${OLD_PRICING_TABLE}`,
          (err: Error | null, rows: any[]) => {
            if (err) reject(err);
            else resolve(rows as Record<string, unknown>[]);
          }
        );
      }
    );

    if (oldRows.length === 0) {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `DROP TABLE IF EXISTS ${OLD_PRICING_TABLE}`,
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
      logger.info('旧 model_pricing 表为空，已直接删除');
      return;
    }

    let migrated = 0;
    for (const old of oldRows) {
      try {
        const id = randomUUID();
        await new Promise<void>((resolve, reject) => {
          this.db!.run(
            `INSERT OR IGNORE INTO ${REGISTRY_TABLE}
             (id, model_id, display_name, input_price, output_price,
              cache_read_price, cache_write_price, provider_id,
              enabled, is_custom, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              old.model_id,
              old.display_name || '',
              (old.input_price as number) ||
                (old.input_cost_per_million as number) ||
                0,
              (old.output_price as number) ||
                (old.output_cost_per_million as number) ||
                0,
              (old.cache_read_price as number) ||
                (old.cache_read_cost_per_million as number) ||
                0,
              (old.cache_write_price as number) ||
                (old.cache_write_cost_per_million as number) ||
                0,
              (old.provider_id as string) || (old.provider as string) || '',
              old.enabled ?? 1,
              old.is_custom ?? 0,
              old.created_at || Math.floor(Date.now() / 1000),
              old.updated_at || Math.floor(Date.now() / 1000),
            ],
            (err: Error | null) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
        migrated++;
      } catch (err) {
        // 单行迁移失败继续下一行
      }
    }

    // 删除旧表
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `DROP TABLE IF EXISTS ${OLD_PRICING_TABLE}`,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    logger.info(
      `旧 model_pricing 表已迁移：${migrated}/${oldRows.length} 条记录 → model_registry，旧表已删除`
    );
  }

  /** 首次启动时从 YAML 种子数据到 DB */
  private async seedFromYamlIfEmpty(): Promise<void> {
    const count = await new Promise<number>((resolve, reject) => {
      this.db!.get(
        `SELECT COUNT(*) as cnt FROM ${REGISTRY_TABLE}`,
        (err: Error | null, row: any) => {
          if (err) reject(err);
          else resolve((row as Record<string, number>).cnt);
        }
      );
    });

    if (count > 0) {
      this.seeded = true;
      return; // 已有数据，不需要种子
    }

    try {
      const { loadDefaultModels } = await import('../config/defaultModels.js');
      const data = loadDefaultModels();
      const modelIds = Object.keys(data.models);

      if (modelIds.length === 0) {
        logger.warning('YAML 种子数据为空，跳过 seeding');
        return;
      }

      let seeded = 0;
      const now = Math.floor(Date.now() / 1000);

      for (const [key, entry] of Object.entries(data.models)) {
        const providerMappings = entry.providers || {};
        const capabilities = entry.capabilities || [];
        const id = randomUUID();

        await new Promise<void>((resolve, reject) => {
          this.db!.run(
            `INSERT OR IGNORE INTO ${REGISTRY_TABLE}
             (id, model_id, display_name, context_window, max_output_tokens,
              capabilities, provider_mappings,
              input_price, output_price, cache_read_price, cache_write_price,
              provider_id, enabled, is_custom, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
            [
              id,
              key,
              entry.displayName || key,
              entry.contextWindow || 128000,
              entry.maxOutputTokens || 8192,
              JSON.stringify(capabilities),
              JSON.stringify(providerMappings),
              entry.pricing?.inputPer1M || 0,
              entry.pricing?.outputPer1M || 0,
              entry.pricing?.cacheReadPer1M || 0,
              entry.pricing?.cacheWritePer1M || 0,
              // 推断主 provider：取 provider_mappings 中除了 firstParty 外的第一个 key
              Object.keys(providerMappings).find((k) => k !== 'firstParty') ||
                '',
              now,
              now,
            ],
            (err: Error | null) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
        seeded++;
      }

      this.seeded = true;
      logger.info(`已从 YAML 种子 ${seeded} 个模型到 model_registry 表`);
    } catch (err) {
      logger.warning('YAML 种子失败（非关键，不影响启动）', {
        error: (err as Error).message,
      });
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new AppError(
        'ModelPricingService not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'PRICING_NOT_INIT'
      );
    }
  }

  /** 获取或更新模型 */
  async upsertPricing(
    params: UpsertPricingParams
  ): Promise<ModelPricingRecord> {
    this.ensureInitialized();

    const now = Math.floor(Date.now() / 1000);
    const existing = await this.getPricing(params.modelId);

    if (existing) {
      const providerMappings = params.providerMappings
        ? JSON.stringify(params.providerMappings)
        : existing.providerMappings
          ? JSON.stringify(existing.providerMappings)
          : '{}';
      const capabilities = params.capabilities
        ? JSON.stringify(params.capabilities)
        : existing.capabilities
          ? JSON.stringify(existing.capabilities)
          : '[]';

      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `UPDATE ${REGISTRY_TABLE} SET
           display_name = ?, context_window = ?, max_output_tokens = ?,
           capabilities = ?, provider_mappings = ?,
           input_price = ?, output_price = ?,
           cache_read_price = ?, cache_write_price = ?,
           cost_multiplier = ?, pricing_source = ?,
           provider_id = ?, updated_at = ?
           WHERE model_id = ?`,
          [
            params.displayName || existing.displayName,
            params.contextWindow ?? existing.contextWindow,
            params.maxOutputTokens ?? existing.maxOutputTokens,
            capabilities,
            providerMappings,
            params.inputCostPerMillion,
            params.outputCostPerMillion,
            params.cacheReadCostPerMillion ?? existing.cacheReadCostPerMillion,
            params.cacheWriteCostPerMillion ??
              existing.cacheWriteCostPerMillion,
            params.costMultiplier ?? existing.costMultiplier ?? 1.0,
            params.pricingSource || existing.pricingSource || 'default',
            params.providerId || existing.providerId || '',
            now,
            params.modelId,
          ],
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    } else {
      const id = randomUUID();
      const providerMappings = params.providerMappings
        ? JSON.stringify(params.providerMappings)
        : '{}';
      const capabilities = params.capabilities
        ? JSON.stringify(params.capabilities)
        : '[]';

      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `INSERT INTO ${REGISTRY_TABLE}
           (id, model_id, display_name, context_window, max_output_tokens,
            capabilities, provider_mappings,
            input_price, output_price, cache_read_price, cache_write_price,
            cost_multiplier, pricing_source,
            provider_id, enabled, is_custom, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [
            id,
            params.modelId,
            params.displayName || params.modelId,
            params.contextWindow ?? 128000,
            params.maxOutputTokens ?? 8192,
            capabilities,
            providerMappings,
            params.inputCostPerMillion,
            params.outputCostPerMillion,
            params.cacheReadCostPerMillion || 0,
            params.cacheWriteCostPerMillion || 0,
            params.costMultiplier ?? 1.0,
            params.pricingSource || 'default',
            params.providerId || '',
            params.enabled !== false ? 1 : 0,
            now,
            now,
          ],
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    }

    return (await this.getPricing(params.modelId))!;
  }

  /** 获取单个模型 */
  async getPricing(modelId: string): Promise<ModelPricingRecord | undefined> {
    this.ensureInitialized();

    return new Promise<ModelPricingRecord | undefined>((resolve, reject) => {
      this.db!.get(
        `SELECT * FROM ${REGISTRY_TABLE} WHERE model_id = ?`,
        [modelId],
        (err: Error | null, row: any) => {
          if (err) reject(err);
          else if (!row) resolve(undefined);
          else resolve(rowToRecord(row as Record<string, unknown>));
        }
      );
    });
  }

  /** 获取所有模型 */
  async getAllPricing(): Promise<ModelPricingRecord[]> {
    this.ensureInitialized();

    return new Promise<ModelPricingRecord[]>((resolve, reject) => {
      this.db!.all(
        `SELECT * FROM ${REGISTRY_TABLE} ORDER BY model_id ASC`,
        (err: Error | null, rows: any[]) => {
          if (err) reject(err);
          else {
            resolve((rows as Record<string, unknown>[]).map(rowToRecord));
          }
        }
      );
    });
  }

  /** 获取所有已启用的模型 */
  async getAllEnabledPricing(): Promise<ModelPricingRecord[]> {
    this.ensureInitialized();

    return new Promise<ModelPricingRecord[]>((resolve, reject) => {
      this.db!.all(
        `SELECT * FROM ${REGISTRY_TABLE} WHERE enabled = 1 ORDER BY model_id ASC`,
        (err: Error | null, rows: any[]) => {
          if (err) reject(err);
          else {
            resolve((rows as Record<string, unknown>[]).map(rowToRecord));
          }
        }
      );
    });
  }

  /** 删除用户自定义模型 */
  async deletePricing(modelId: string): Promise<boolean> {
    this.ensureInitialized();

    return new Promise<boolean>((resolve, reject) => {
      this.db!.run(
        `DELETE FROM ${REGISTRY_TABLE} WHERE model_id = ? AND is_custom = 1`,
        [modelId],
        function (this: any, err: Error | null) {
          if (err) reject(err);
          else resolve(this.changes > 0);
        }
      );
    });
  }

  /** 切换模型启用/停用 */
  async toggleModel(modelId: string): Promise<boolean | null> {
    this.ensureInitialized();

    const record = await this.getPricing(modelId);
    if (!record) return null;

    const newEnabled = record.enabled ? 0 : 1;
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `UPDATE ${REGISTRY_TABLE} SET enabled = ?, updated_at = ? WHERE model_id = ?`,
        [newEnabled, Math.floor(Date.now() / 1000), modelId],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    return newEnabled === 1;
  }

  /** 删除模型（不限 is_custom） */
  async deleteModel(modelId: string): Promise<boolean> {
    this.ensureInitialized();
    const existing = await this.getPricing(modelId);
    if (!existing) return false;

    await this.runAsync(`DELETE FROM ${REGISTRY_TABLE} WHERE model_id = ?`, [
      modelId,
    ]);
    return true;
  }

  /** 按 UUID 查询模型记录 */
  async getPricingById(id: string): Promise<ModelPricingRecord | undefined> {
    this.ensureInitialized();

    return new Promise<ModelPricingRecord | undefined>((resolve, reject) => {
      this.db!.get(
        `SELECT * FROM ${REGISTRY_TABLE} WHERE id = ?`,
        [id],
        (err: Error | null, row: any) => {
          if (err) reject(err);
          else if (!row) resolve(undefined);
          else resolve(rowToRecord(row as Record<string, unknown>));
        }
      );
    });
  }

  /** 按 UUID 切换模型启用/停用 */
  async toggleModelById(
    id: string
  ): Promise<{ modelId: string; enabled: boolean } | null> {
    this.ensureInitialized();
    const record = await this.getPricingById(id);
    if (!record) return null;

    const newEnabled = record.enabled ? 0 : 1;
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `UPDATE ${REGISTRY_TABLE} SET enabled = ?, updated_at = ? WHERE id = ?`,
        [newEnabled, Math.floor(Date.now() / 1000), id],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    return { modelId: record.modelId, enabled: newEnabled === 1 };
  }

  /** 按 UUID 删除模型 */
  async deleteModelById(id: string): Promise<boolean> {
    this.ensureInitialized();
    const existing = await this.getPricingById(id);
    if (!existing) return false;

    await this.runAsync(`DELETE FROM ${REGISTRY_TABLE} WHERE id = ?`, [id]);
    return true;
  }

  /** 获取模型计数 */
  async getModelCount(): Promise<number> {
    this.ensureInitialized();

    return new Promise<number>((resolve, reject) => {
      this.db!.get(
        `SELECT COUNT(*) as cnt FROM ${REGISTRY_TABLE}`,
        (err: Error | null, row: any) => {
          if (err) reject(err);
          else resolve((row as Record<string, number>).cnt);
        }
      );
    });
  }

  /** 重新从 YAML 种子数据（覆盖现有种子数据，保留用户自定义数据） */
  async reSeedFromYaml(): Promise<number> {
    this.ensureInitialized();

    try {
      const { loadDefaultModels } = await import('../config/defaultModels.js');
      const data = loadDefaultModels();
      const now = Math.floor(Date.now() / 1000);

      let updated = 0;
      for (const [key, entry] of Object.entries(data.models)) {
        const providerMappings = JSON.stringify(entry.providers || {});
        const capabilities = JSON.stringify(entry.capabilities || []);
        const id = randomUUID();

        // UPSERT: 只覆盖 is_custom=0 的种子行，不更新 id 字段
        await new Promise<void>((resolve, reject) => {
          this.db!.run(
            `INSERT INTO ${REGISTRY_TABLE}
             (id, model_id, display_name, context_window, max_output_tokens,
              capabilities, provider_mappings,
              input_price, output_price, cache_read_price, cache_write_price,
              provider_id, enabled, is_custom, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
             ON CONFLICT(model_id) DO UPDATE SET
              display_name = excluded.display_name,
              context_window = excluded.context_window,
              max_output_tokens = excluded.max_output_tokens,
              capabilities = excluded.capabilities,
              provider_mappings = excluded.provider_mappings,
              input_price = excluded.input_price,
              output_price = excluded.output_price,
              cache_read_price = excluded.cache_read_price,
              cache_write_price = excluded.cache_write_price,
              provider_id = excluded.provider_id,
              updated_at = excluded.updated_at
             WHERE is_custom = 0`,
            [
              id,
              key,
              entry.displayName || key,
              entry.contextWindow || 128000,
              entry.maxOutputTokens || 8192,
              capabilities,
              providerMappings,
              entry.pricing?.inputPer1M || 0,
              entry.pricing?.outputPer1M || 0,
              entry.pricing?.cacheReadPer1M || 0,
              entry.pricing?.cacheWritePer1M || 0,
              Object.keys(entry.providers || {}).find(
                (k) => k !== 'firstParty'
              ) || '',
              now,
              now,
            ],
            function (this: { changes: number }, err: Error | null) {
              if (err) reject(err);
              else {
                updated += this.changes || 0;
                resolve();
              }
            }
          );
        });
      }

      logger.info(`YAML 数据重新同步完成：${updated} 条更新`);
      return updated;
    } catch (err) {
      logger.error('YAML 重新同步失败', err);
      throw err;
    }
  }
}

export const modelPricingService = ModelPricingService.getInstance();
