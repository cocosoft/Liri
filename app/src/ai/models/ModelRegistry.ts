/**
 * 运行时模型注册表
 *
 * DB（model_registry 表）是模型定义的唯一事实来源。
 * YAML 仅作为首次运行（DB 为空）时的兜底数据。
 *
 * 数据流：ModelPricingService.initialize() → YAML 种子 → DB
 *         → ModelRegistry.loadModelsFromDb() → 内存缓存
 */

import { ModelCapability } from './types.js';
import type { ModelConfig, APIProvider, ModelKey } from './types.js';
import { API_PROVIDER_KEYS } from './types.js';
import {
  loadDefaultModels,
  type ModelYamlConfig,
} from '../config/defaultModels.js';
import {
  loadProvidersConfig,
  loadModelsConfig,
  type ProviderConfig,
} from '../config/ConfigLoader.js';
import { getLogger } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';
import type { BillingMode, TimeBasedPrice } from './ModelPricingService.js';

const logger = getLogger('ai:registry');

/** 将 YAML 格式的 providers 映射转换为平面字段 */
function yamlEntryToModelConfig(
  entry: ModelYamlConfig,
  key: string
): ModelConfig {
  const providers: Record<string, string> = {};
  for (const pk of API_PROVIDER_KEYS) {
    providers[pk] = entry.providers[pk] ?? '';
  }

  const caps: ModelCapability[] = [];
  if (entry.capabilities) {
    for (const c of entry.capabilities) {
      const upper = c.toUpperCase() as keyof typeof ModelCapability;
      const val = ModelCapability[upper];
      if (val !== undefined) {
        caps.push(val);
      }
    }
  }

  return {
    ...(providers as unknown as ModelConfig),
    displayName: entry.displayName,
    contextWindow: entry.contextWindow,
    maxOutputTokens: entry.maxOutputTokens,
    ...(caps.length > 0 && { capabilities: caps }),
    ...(entry.pricing && { pricing: entry.pricing }),
    ...(entry.extendedContextWindows && {
      extendedContextWindows: entry.extendedContextWindows,
    }),
  };
}

/**
 * 运行时模型注册表
 *
 * 模型定义 + 定价双源设计：
 * - 模型定义（字段、能力、provider 映射）→ YAML 加载 → builtinModels
 * - 模型定价 + 启停 → DB model_registry → 内存缓存
 */
export class ModelRegistry {
  private static instance: ModelRegistry;

  private builtinModels: Map<string, ModelConfig> = new Map();
  private userModels: Map<string, ModelConfig> = new Map();
  private discoveredModels: Map<string, ModelConfig> = new Map();

  private providerConfigs: Map<string, ProviderConfig> = new Map();

  /** DB 中加载的定价缓存，键为 modelId（唯一来源） */
  private dbPricing: Map<
    string,
    {
      inputPer1M: number;
      outputPer1M: number;
      billingMode: BillingMode;
      pricePerRequest: number;
      timeBasedPricing: TimeBasedPrice[];
    }
  > = new Map();

  /**
   * refreshDbPricing 互斥锁。
   * 多处调用（本地模型同步/云端模型 CRUD/上下文窗口解析）可能并发，
   * 不加锁会导致 loadModelsFromDb + loadDbPricing 交错执行，
   * 中间状态（模型已更新但定价未更新）被其他读取方观察到。
   * 用 promise chain 串行化所有刷新请求。
   */
  private refreshInFlight: Promise<void> = Promise.resolve();

  /**
   * refreshDbPricing 调用序号（自增），仅用于日志排查排队顺序。
   * 入队时分配 seq，日志中呈现 #seq 让用户清楚看到请求的到达与执行顺序。
   */
  private refreshSeq = 0;

  /**
   * refreshDbPricing 已完成序号（用于计算后续请求的 queueDepth）。
   * 与 refreshSeq 配合：queueDepth = refreshSeq - refreshDoneSeq - 1。
   */
  private refreshDoneSeq = 0;

  private constructor() {
    // 启动时通过 loadDefaultModels + loadDbPricing 初始化
  }

  static getInstance(): ModelRegistry {
    if (!ModelRegistry.instance) {
      ModelRegistry.instance = new ModelRegistry();
    }
    return ModelRegistry.instance;
  }

  /** 从 YAML 加载内置默认模型（兜底：仅 DB 无数据时使用） */
  loadDefaultModels(): void {
    const data = loadDefaultModels();
    for (const [key, entry] of Object.entries(data.models)) {
      this.builtinModels.set(key, yamlEntryToModelConfig(entry, key));
    }
  }

  /**
   * 从 DB（model_registry 表）加载模型定义
   * @returns true 表示成功从 DB 加载了数据，false 表示 DB 为空
   */
  async loadModelsFromDb(): Promise<boolean> {
    const { modelPricingService } =
      await import('@modules/ai/models/ModelPricingService.js');
    await modelPricingService.initialize();
    const all = await modelPricingService.getAllPricing();

    if (all.length === 0) {
      logger.debug('DB 中无模型记录');
      return false;
    }

    // 用 DB 数据重建 builtinModels
    const dbModels = new Map<string, ModelConfig>();
    for (const rec of all) {
      // 将 providerMappings 展开为 per-provider 字段
      const providers: Record<string, string> = {};
      for (const pk of API_PROVIDER_KEYS) {
        providers[pk] = rec.providerMappings?.[pk] ?? '';
      }
      // 如果有 providerId 且映射中无对应 key，用 modelId 填充 firstParty
      if (rec.providerId && !Object.values(rec.providerMappings ?? {}).length) {
        providers.firstParty = rec.modelId;
      }

      const caps: ModelCapability[] = [];
      if (rec.capabilities?.length) {
        for (const c of rec.capabilities) {
          const upper = c.toUpperCase() as keyof typeof ModelCapability;
          if (ModelCapability[upper] !== undefined) {
            caps.push(ModelCapability[upper]);
          }
        }
      }

      dbModels.set(rec.modelId, {
        ...(providers as unknown as ModelConfig),
        displayName: rec.displayName || rec.modelId,
        contextWindow: rec.contextWindow || 200000,
        maxOutputTokens: rec.maxOutputTokens || 4096,
        ...(caps.length > 0 && { capabilities: caps }),
      });
    }

    this.builtinModels = dbModels;
    logger.info(`从 DB 加载了 ${dbModels.size} 个模型定义`);
    // 上下文窗口排查锚点：列出本地/小窗口模型，便于确认 DB 值已正确入内存缓存。
    // llama.cpp/ollama 模型 window 错配会在此暴露（如 4096 被旧值 200K 覆盖）。
    const smallCtxModels = Array.from(dbModels.entries())
      .filter(([, cfg]) => cfg.contextWindow < 65_536)
      .map(([id, cfg]) => ({ modelId: id, contextWindow: cfg.contextWindow }));
    if (smallCtxModels.length > 0) {
      logger.info('registry:小窗口模型（context_window < 64K）', {
        count: smallCtxModels.length,
        models: smallCtxModels,
      });
    }
    return true;
  }

  /** 从 ModelPricingService（DB）加载定价到内存缓存 */
  async loadDbPricing(): Promise<void> {
    const otel = getOTelTracing();
    const span = otel.startSpan('model.registry.loadPricing', {});

    try {
      const { modelPricingService } =
        await import('@modules/ai/models/ModelPricingService.js');
      await modelPricingService.initialize();
      const all = await modelPricingService.getAllPricing();
      this.dbPricing.clear();
      for (const rec of all) {
        this.dbPricing.set(rec.modelId, {
          inputPer1M: rec.inputCostPerMillion,
          outputPer1M: rec.outputCostPerMillion,
          billingMode: rec.billingMode,
          pricePerRequest: rec.pricePerRequest,
          timeBasedPricing: rec.timeBasedPricing,
        });
      }
      otel.endSpan(span, SpanStatusCode.OK);
    } catch (err) {
      void handleError(err, {
        module: 'ai:registry',
        action: 'loadDbPricing',
      });
      otel.endSpan(span, SpanStatusCode.ERROR, (err as Error).message);
    }
  }

  /** 加载用户配置（providers.yaml + models.yaml）— 不含 pricing，pricing 统一走 DB */
  loadUserConfigs(): void {
    const providersCfg = loadProvidersConfig();
    const modelsCfg = loadModelsConfig();

    for (const [id, cfg] of Object.entries(providersCfg.providers)) {
      this.providerConfigs.set(id, cfg);
    }

    for (const [modelId, override] of Object.entries(modelsCfg.models)) {
      if (override.baseModel && this.builtinModels.has(override.baseModel)) {
        const base = this.builtinModels.get(override.baseModel)!;
        this.userModels.set(modelId, {
          ...base,
          firstParty: modelId,
          displayName: override.displayName ?? base.displayName,
          contextWindow: override.contextWindow ?? base.contextWindow,
          maxOutputTokens: override.maxOutputTokens ?? base.maxOutputTokens,
          ...(override.capabilities && {
            capabilities: override.capabilities as ModelCapability[],
          }),
        });
      } else {
        const existing = this.builtinModels.get(modelId);
        this.userModels.set(modelId, {
          ...(existing ?? ({} as ModelConfig)),
          firstParty: modelId,
          displayName: override.displayName ?? existing?.displayName ?? modelId,
          contextWindow:
            override.contextWindow ?? existing?.contextWindow ?? 200000,
          maxOutputTokens:
            override.maxOutputTokens ?? existing?.maxOutputTokens ?? 4096,
          ...(override.capabilities && {
            capabilities: override.capabilities as ModelCapability[],
          }),
        });
      }
    }
  }

  getAllModels(): ModelConfig[] {
    const result = new Map(this.builtinModels);
    for (const [id, cfg] of this.userModels) result.set(id, cfg);
    for (const [id, cfg] of this.discoveredModels) {
      if (!result.has(id)) result.set(id, cfg);
    }
    return Array.from(result.values());
  }

  getModel(modelId: string): ModelConfig | undefined {
    return (
      this.userModels.get(modelId) ??
      this.discoveredModels.get(modelId) ??
      this.builtinModels.get(modelId)
    );
  }

  getProviderConfig(providerId: string): ProviderConfig | undefined {
    return this.providerConfigs.get(providerId);
  }

  getAllProviderConfigs(): Map<string, ProviderConfig> {
    return new Map(this.providerConfigs);
  }

  discoverModel(modelId: string, config: Partial<ModelConfig>): void {
    this.discoveredModels.set(modelId, {
      firstParty: modelId,
      displayName: modelId,
      contextWindow: 200000,
      maxOutputTokens: 4096,
      ...config,
    } as ModelConfig);
  }

  /** 根据模型名查询内置键名 */
  getModelKeyByName(modelName: string): string | null {
    for (const [key, config] of this.builtinModels) {
      const providerKeys: (keyof ModelConfig)[] = [
        'firstParty',
        'bedrock',
        'vertex',
        'azure',
        'openai',
        'deepseek',
        'google',
        'grok',
        'moonshot',
        'ollama',
      ];
      for (const pk of providerKeys) {
        if (
          (config as unknown as Record<string, string>)[pk as string] ===
          modelName
        ) {
          return key;
        }
      }
    }
    return null;
  }

  /** 获取模型在指定提供商的名称 */
  getModelNameForProvider(modelKey: string, provider: APIProvider): string {
    const config = this.builtinModels.get(modelKey);
    if (!config) return '';
    return (config as unknown as Record<string, string>)[provider] || '';
  }

  /** 获取指定提供商的模型列表 */
  getModelsByProvider(provider: APIProvider): string[] {
    const result: string[] = [];
    for (const [key, config] of this.builtinModels) {
      if ((config as unknown as Record<string, string>)[provider]) {
        result.push(key);
      }
    }
    return result;
  }

  /** 以 Record 形式返回所有模型（用于向后兼容 ALL_MODEL_CONFIGS） */
  getAllModelsAsRecord(): Record<string, ModelConfig> {
    const result: Record<string, ModelConfig> = {};
    for (const [key, config] of this.builtinModels) {
      result[key] = config;
    }
    for (const [key, config] of this.userModels) {
      result[key] = config;
    }
    for (const [key, config] of this.discoveredModels) {
      if (!result[key]) result[key] = config;
    }
    return result;
  }

  /** 获取模型在指定提供商的字段值 */
  getProviderField(modelKey: string, provider: APIProvider): string {
    const config =
      this.builtinModels.get(modelKey) ??
      this.userModels.get(modelKey) ??
      this.discoveredModels.get(modelKey);
    if (!config) return '';
    return (config as unknown as Record<string, string>)[provider] || '';
  }

  /** DB 定价缓存条目（含计费模式/按次/分时） */
  getModelPricing(modelName: string): {
    inputPer1M: number;
    outputPer1M: number;
    billingMode: BillingMode;
    pricePerRequest: number;
    timeBasedPricing: TimeBasedPrice[];
  } | null {
    // DB 定价是唯一来源，不再 fallback 到 YAML
    // 避免"DB 删除后仍能读到 YAML 旧价"的混淆
    return this.dbPricing.get(modelName) || null;
  }

  /** 异步获取模型定价 — 从 DB 实时查询（更精确，例如用于计费） */
  async getModelPricingAsync(modelName: string): Promise<{
    inputPer1M: number;
    outputPer1M: number;
    billingMode: BillingMode;
    pricePerRequest: number;
    timeBasedPricing: TimeBasedPrice[];
  } | null> {
    try {
      const { modelPricingService } =
        await import('@modules/ai/models/ModelPricingService.js');
      // 确保已初始化
      await modelPricingService.initialize();
      const dbPricing = await modelPricingService.getPricing(modelName);
      if (dbPricing) {
        return {
          inputPer1M: dbPricing.inputCostPerMillion,
          outputPer1M: dbPricing.outputCostPerMillion,
          billingMode: dbPricing.billingMode,
          pricePerRequest: dbPricing.pricePerRequest,
          timeBasedPricing: dbPricing.timeBasedPricing,
        };
      }
    } catch (err) {
      void handleError(err, {
        module: 'ai:registry',
        action: 'getDbPricingFresh',
      });
    }
    return this.getModelPricing(modelName);
  }

  /**
   * 刷新 DB 运行时缓存（API upsert/toggle 后调用）。
   * 定价 + 模型定义双刷新：model_registry 是模型定义（context_window/capabilities 等）
   * 与定价的共同唯一事实来源，任一字段变更都必须同步重建 builtinModels——
   * 否则 resolveContextWindow/getContextWindow 等同步读取路径会命中过期窗口
   * （如 llama.cpp 服务端 n_ctx=4096 已被旧值 200K 掩盖，导致发送前截断不触发）。
   *
   * 并发治理：本地模型同步（llama/ollama）与云端模型 CRUD 可能并发触发本方法，
   * 用 promise chain 串行化（refreshInFlight），避免 loadModelsFromDb + loadDbPricing
   * 交错执行导致中间状态被读取方观察到（竞态根因：本地与云端刷新互相覆盖）。
   */
  async refreshDbPricing(): Promise<void> {
    // 入队：分配序号，记录到达顺序
    const seq = ++this.refreshSeq;
    logger.info(`registry:refreshDbPricing #${seq} 入队`, {
      seq,
      queueDepth: this.refreshSeq - this.refreshDoneSeq - 1, // 当前排在多少个之后
    });

    // 串行化：当前刷新等待前一个完成（忽略前一个的错误），然后执行。
    // refreshInFlight 始终 resolve（链不断），但 current 的错误会传播给调用方。
    const previous = this.refreshInFlight;
    const current = (async () => {
      const waitStart = Date.now();
      await previous.catch(() => {
        // 前一次刷新失败不影响本次，仅等待其结束
      });
      const waitMs = Date.now() - waitStart;
      if (waitMs > 50) {
        // 等待超过 50ms 说明确实有前序刷新在执行，记录实际排队时长
        logger.info(`registry:refreshDbPricing #${seq} 出队开始执行`, {
          seq,
          queuedForMs: waitMs,
        });
      }
      // 排查锚点：记录刷新前窗口基线，便于对比刷新后是否真的更新了 builtinModels。
      const beforeIds = new Set(this.builtinModels.keys());
      await this.loadModelsFromDb();
      await this.loadDbPricing();
      this.refreshDoneSeq = seq; // 标记本序号已完成（用于计算后续请求的 queueDepth）
      const afterIds = new Set(this.builtinModels.keys());
      logger.info(`registry:refreshDbPricing #${seq} 完成`, {
        seq,
        beforeCount: beforeIds.size,
        afterCount: afterIds.size,
        modelsAdded: [...afterIds].filter((id) => !beforeIds.has(id)).length,
        modelsRemoved: [...beforeIds].filter((id) => !afterIds.has(id)).length,
      });
    })();
    // 链不断：current 失败时 refreshInFlight 仍 resolve，不影响后续调用排队
    this.refreshInFlight = current.catch(() => {
      // 失败也标记完成序号（否则后续请求的 queueDepth 会一直累加）
      this.refreshDoneSeq = seq;
    });
    return current;
  }
}
