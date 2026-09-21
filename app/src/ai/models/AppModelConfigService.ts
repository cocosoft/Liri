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
 * AppModelConfigService — 应用模型配置服务
 *
 * 职责：按应用类型（AppModelTarget）从 SQLite 路由模型配置。
 *       仅由 ModelManagementAPI 使用（管理通道），不参与运行时 chat 请求。
 *
 * 历史说明：重命名自 AppModelRouter（原名有 Router 后缀但非路由决策层），
 * 更名为 AppModelConfigService 以强调其作为配置管理服务的职责，
 * 消除与 ModelRouter / SmartRouter 的歧义。
 *
 * 与 ModelRouter 的关系：
 *   两者都管"模型选择"，但维度不同——ModelRouter 按任务类型（TaskType）
 *   从 ConfigManager 静态路由，AppModelConfigService 按应用类型从 SQLite 路由。
 *   两者是互补关系，不是冲突。
 *
 * 与 SmartRouter 的关系：
 *   无直接交互。SmartRouter 走运行时决策管线，AppModelConfigService 走管理 API。
 *
 * 数据源：
 *   SQLite 表 app_model_configs，通过 resolveDbPath() 获取。
 *
 * 支持 per-app 模型配置：不同的应用类型（CLI/API/Agent/Tool/Plugin）
 * 可以使用不同的模型。对标 CC 源码 cc-switch/src-tauri/src/app_config.rs (AppType)
 */

import { Database } from '@modules/core/external/sqlite3';
import { resolveDbPath, ensureDir } from '@modules/core';
import { dirname } from 'path';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

const logger = getLogger('ai:models:appModelConfigService');

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
  /**
   * 配置来源（N-46，2026-09-20）：
   * - `'user'`：用户经「模型管理→任务分工」显式保存（`ModelRouter.setTasks`）⇒
   *   `resolveModelRoute` 对 chat 类 route **以本配置为准**（优先于 SmartRouter 档位）；
   * - `'seed'`：系统播种/自动清理（`ensureDefaultEntry` / `cleanNonChatModelEntries` /
   *   历史迁移）⇒ 仅作兜底，不覆盖 SmartRouter。
   *
   * 历史行（本列引入前）一律回填 `'seed'`（保守）：见 `migrateAddSourceColumn` 注释。
   */
  source?: 'user' | 'seed';
}

/**
 * 应用模型配置服务
 *
 * 单例服务，管理不同应用类型的模型选择。
 * 数据持久化到 app.db 的 ai_app_model_configs 表。
 */
export class AppModelConfigService {
  private static instance: AppModelConfigService;

  private db: Database | null = null;
  private dbPath: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  /** 内存缓存 */
  private cache: Map<string, AppModelConfig> = new Map();

  private constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  static getInstance(dbPath?: string): AppModelConfigService {
    if (!AppModelConfigService.instance) {
      AppModelConfigService.instance = new AppModelConfigService(dbPath);
    }
    return AppModelConfigService.instance;
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
      logger.debug('AppModelConfigService DB 目录', {
        dir,
        dbPath: this.dbPath,
      });

      this.db = await new Promise<Database>((resolve, reject) => {
        const db = new Database(this.dbPath, (err: Error | null) => {
          if (err) reject(err);
          else resolve(db);
        });
      });

      await this.createTable();
      // 先标记已初始化，再调用 ensureDefaultEntry（内部需要 getConfig）
      this.initialized = true;
      await this.ensureDefaultEntry();
      await this.cleanNonChatModelEntries();
      logger.info('AppModelConfigService 初始化完成');
    } catch (error) {
      await handleError(error, {
        module: 'ai:model_config',
        action: 'initialize',
        context: { dbPath: this.dbPath },
      });
      throw new AppError(
        `Failed to initialize AppModelConfigService: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'AMC_INIT_FAILED',
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
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
          source TEXT NOT NULL DEFAULT 'seed'
        )
      `,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    await this.migrateAddSourceColumn();

    logger.info('ai_app_model_configs 表创建/验证完成');
  }

  /**
   * N-46（2026-09-20）：为既有库补 `source` 列（仅新增字段，不删结构）。
   *
   * **历史行一律回填 `'seed'`（保守）** —— 本列引入前的行无法区分"用户显式设定"与
   * "批量播种/一次性保存"（实测 18 行 `updated_at` 全部落在同一秒 `2026-09-19T04:20:14`）。
   * 若把历史值当作"用户显式配置"，会**立刻**造成两类故障：`agent`/`local` 指向
   * llama.cpp（供应商未注册）、`quick`/`translation` 指向 SiliconFlow 模型（账户余额不足 402）
   * —— 这也反证这些行是**陈旧播种值**而非当前意图。用户重新保存一次即转为 `'user'` 生效。
   */
  private async migrateAddSourceColumn(): Promise<void> {
    const cols = await new Promise<Array<{ name: string }>>(
      (resolve, reject) => {
        this.db!.all(
          `PRAGMA table_info(${APP_CONFIG_TABLE})`,
          (err: Error | null, rows: unknown) => {
            if (err) reject(err);
            else resolve((rows as Array<{ name: string }>) ?? []);
          }
        );
      }
    );
    if (cols.some((c) => c.name === 'source')) return;

    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `ALTER TABLE ${APP_CONFIG_TABLE} ADD COLUMN source TEXT NOT NULL DEFAULT 'seed'`,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    logger.info(
      "ai_app_model_configs: 已补 source 列（历史行回填 'seed'，用户重新保存后转为 'user'）"
    );
  }

  private async ensureDefaultEntry(): Promise<void> {
    // 从 model_registry 获取第一个启用的聊天模型（排除 embedding/生图等非聊天能力）
    const { modelPricingService } = await import('./ModelPricingService.js');
    await modelPricingService.initialize();
    const allModels = await modelPricingService.getAllPricing();
    const nonChatCaps = [
      'image_generation',
      'video_generation',
      'text_to_video',
      'image_to_video',
      'embedding',
      'text_to_speech',
      'speech_recognition',
      'reranking',
      'moderation',
      'image_editing',
    ];
    const chatModels = allModels
      .filter((m) => m.enabled && m.modelId)
      .filter((m) => {
        if (m.capabilities?.some((c) => nonChatCaps.includes(c))) return false;
        return true;
      });
    const validDefaultId = chatModels.length > 0 ? chatModels[0].modelId : '';

    // 检查已有默认条目：若非聊天模型则清理重选
    const existing = await this.getConfig('default');
    if (existing?.model) {
      const isNonChat = allModels.some(
        (m) =>
          m.modelId === existing.model &&
          m.capabilities?.some((c) => nonChatCaps.includes(c))
      );
      if (!isNonChat) return; // 已是有效聊天模型，无需重选
      logger.warning('默认模型为非聊天模型，自动清理重选', {
        oldModel: existing.model,
      });
      await this.setConfig('default', { model: validDefaultId });
      return;
    }

    // 无默认条目 → 新建
    await this.setConfig('default', { model: validDefaultId });
  }

  /**
   * 清理所有对话类任务条目中的非聊天模型（如 Embedding 模型被误设为对话模型）。
   * 确保 modelRouter 不会把 BAAI/bge-m3 之类的模型返回给 ChatManager。
   *
   * 对话类任务：chat/coding/translation/quick/agent/scheduled/local/default/current
   * 能力类任务（不清理）：embedding/image/vision/ocr/text_to_video/image_to_video
   */
  private async cleanNonChatModelEntries(): Promise<void> {
    const nonChatCaps = [
      'image_generation',
      'video_generation',
      'text_to_video',
      'image_to_video',
      'embedding',
      'text_to_speech',
      'speech_recognition',
      'reranking',
      'moderation',
      'image_editing',
    ];

    // 对话类任务类型（需要聊天模型，不能是 embedding 等非聊天模型）
    const chatTaskTypes = [
      'current',
      'default',
      'chat',
      'coding',
      'translation',
      'quick',
      'agent',
      'scheduled',
      'local',
    ];

    try {
      const { modelPricingService } = await import('./ModelPricingService.js');
      await modelPricingService.initialize();
      const allModels = await modelPricingService.getAllPricing();

      for (const appType of chatTaskTypes) {
        const config = await this.getConfig(appType);
        if (!config?.model) continue;

        // 排查 L-3：记录每个 chat 任务类型的配置模型（UUID/模型名），确认指向是否正常
        logger.info('cleanNonChatModelEntries: 检查 chat 任务模型配置', {
          appType,
          configuredModel: config.model,
          providerId: config.providerId,
        });

        const isNonChat = allModels.some(
          (m) =>
            // 修复：config.model 存的是模型 UUID（如 0191cb75-...），
            // 原仅匹配 m.modelId（模型名）导致 UUID 场景永不命中、
            // 非聊天模型条目无法自动清理——同时匹配 id（UUID）与 modelId
            (m.modelId === config.model || m.id === config.model) &&
            m.capabilities?.some((c) => nonChatCaps.includes(c))
        );
        if (isNonChat) {
          logger.warning(
            `AppModelConfig: ${appType} 条目为非聊天模型，自动清理`,
            { model: config.model }
          );
          await this.setConfig(appType, { model: '' });
          this.cache.delete(appType);
        }
      }
    } catch (err) {
      logger.debug(
        'cleanNonChatModelEntries 跳过（modelPricingService 未就绪）',
        {
          error: (err as Error).message,
        }
      );
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new AppError(
        'AppModelConfigService not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'AMC_NOT_INIT'
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
        (err: Error | null, row: any) => {
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
              // N-46：未标记（旧行/异常）一律按 'seed' 处理（保守：不覆盖 SmartRouter 档位）
              source: (r.source === 'user' ? 'user' : 'seed') as
                | 'user'
                | 'seed',
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
      /**
       * N-46：来源标记。默认 `'seed'`（保守 —— 系统播种/自动清理不应夺走路由决定权）；
       * **用户保存路径**（`ModelRouter.setTasks` ← `PUT /v1/models/tasks`）传 `'user'`，
       * 使其在 chat 类 route 上优先于 SmartRouter 档位。
       */
      source?: 'user' | 'seed';
    }
  ): Promise<AppModelConfig> {
    this.ensureInitialized();

    const now = Math.floor(Date.now() / 1000);
    const existing = await this.getConfig(appType);

    if (existing) {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `UPDATE ${APP_CONFIG_TABLE} SET
           model = ?, provider_id = ?, fallback_model = ?, fallback_provider_id = ?, updated_at = ?, source = ?
           WHERE app_type = ?`,
          [
            params.model ?? existing.model,
            params.providerId ?? existing.providerId ?? null,
            params.fallbackModel ?? existing.fallbackModel ?? null,
            params.fallbackProviderId ?? existing.fallbackProviderId ?? null,
            now,
            params.source ?? existing.source ?? 'seed',
            appType,
          ],
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    } else {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `INSERT INTO ${APP_CONFIG_TABLE}
           (app_type, model, provider_id, fallback_model, fallback_provider_id, updated_at, source)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            appType,
            params.model || '',
            params.providerId || null,
            params.fallbackModel || null,
            params.fallbackProviderId || null,
            now,
            params.source ?? 'seed',
          ],
          (err: Error | null) => {
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
        (err: Error | null, rows: unknown[]) => {
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
        'AMC_NO_DELETE_DEFAULT'
      );
    }

    this.ensureInitialized();

    return new Promise<boolean>((resolve, reject) => {
      this.db!.run(
        `DELETE FROM ${APP_CONFIG_TABLE} WHERE app_type = ?`,
        [appType],
        function (this: { changes: number }, err: Error | null) {
          if (err) reject(err);
          else {
            if (this.changes > 0) {
              AppModelConfigService.instance?.cache.delete(appType);
            }
            resolve(this.changes > 0);
          }
        }
      );
    });
  }
}

export const appModelConfigService = AppModelConfigService.getInstance();
