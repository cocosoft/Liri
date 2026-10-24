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
import { getLogger } from '@modules/monitoring/logs/Logger.js';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error/handleError.js';
import type { BillingMode, TimeBasedPrice } from './ModelPricingService.js';
// 租户库 §8-#14 A2：`model_registry` / `providers` 都是按**用户**落行（`owner_key`）
// ⇒ 运行时缓存必须按所有者分桶，否则同租户两用户的同名模型/同一供应商类型互相覆盖。
import {
  getRequestPrincipalKey,
  isLocalPrincipal,
} from '@openliri/kernel/identity/requestScope.js';
import { registerScopedResource } from '@openliri/kernel/identity/scopedResources.js';
// 2026-10-01 B14b（甲′）：把模型窗口同步推入 infra 级缓存 `utils/ContextWindowResolver`
// 自持的 modelWindows 映射，使该解析器无需再静态依赖本模块（app 层）⇒ 该文件 app-free。
// 推入发生在内存映射变更的同一时刻（非异步预热）⇒ 与"同步读本注册表"语义等价、零竞态。
// `ai(app) -> utils(infra)` 为合法方向，不新增跨层对。
import { setModelWindow } from '@modules/utils/ContextWindowResolver';

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
 * 由 `model_registry` 记录构建「wire 别名（小写）→ 规范 modelId」索引
 *
 * 2026-10-22（用量历史归一化）：供应商实际接收的是 `provider_mappings` 里的 wire 名，
 * 而规范 modelId 才是注册表/定价/用量的唯一口径。此处把它反查成表，供
 * `resolveModelAlias()` 使用（纯函数，便于单测）。
 *
 * 规则：跳过空值与非字符串；与规范名相同的值不算别名；同一 wire 名被多个模型占用时**先入者胜**
 * （不猜、不覆盖，冲突留给注册表唯一性约束去暴露）。
 */
export function buildModelAliasIndex(
  records: ReadonlyArray<{
    modelId: string;
    providerMappings?: Record<string, string> | null;
  }>
): Map<string, string> {
  const index = new Map<string, string>();
  for (const rec of records) {
    for (const wire of Object.values(rec.providerMappings ?? {})) {
      const alias = typeof wire === 'string' ? wire.trim() : '';
      if (!alias) continue;
      const key = alias.toLowerCase();
      if (key === rec.modelId.toLowerCase()) continue;
      if (!index.has(key)) index.set(key, rec.modelId);
    }
  }
  return index;
}

/** DB 定价缓存条目（含计费模式/按次/分时） */
interface PricingEntry {
  inputPer1M: number;
  outputPer1M: number;
  billingMode: BillingMode;
  pricePerRequest: number;
  timeBasedPricing: TimeBasedPrice[];
}

/**
 * 单个所有者的运行时缓存（内部键均为模型名 / 供应商 id）。
 *
 * 键 = `<tenantId>:<userId>`（无请求作用域 ⇒ `local:local`，桌面/CLI 零行为变更）。
 */
interface OwnerCache {
  builtinModels: Map<string, ModelConfig>;
  userModels: Map<string, ModelConfig>;
  discoveredModels: Map<string, ModelConfig>;
  /** DB 同步的供应商凭据（按用户；读取时覆盖 YAML） */
  providerConfigs: Map<string, ProviderConfig>;
  /** 键为 modelId（唯一来源） */
  dbPricing: Map<string, PricingEntry>;
  /**
   * 别名索引：wire 名（小写）→ 规范 modelId
   *
   * 数据源 = DB `model_registry.provider_mappings` 的**值**（各供应商实际接收的 wire 名）。
   * 例：`deepseek-v4-flash` 的 `{"deepseek":"deepseek-flash"}` ⇒ `deepseek-flash → deepseek-v4-flash`。
   *
   * 2026-10-22（用量历史归一化）：之前别名无法还原 ⇒ 用量库/成本库会原样落下 wire 名
   * （历史 `deepseek-flash` 3183 行即由此而来），且规范名与别名在汇总里被拆成两档。
   */
  modelAliasIndex: Map<string, string>;
}

function createOwnerCache(): OwnerCache {
  return {
    builtinModels: new Map(),
    userModels: new Map(),
    discoveredModels: new Map(),
    providerConfigs: new Map(),
    dbPricing: new Map(),
    modelAliasIndex: new Map(),
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

  /**
   * 所有者分桶（`<tenantId>:<userId>`）。
   *
   * `model_registry` 与 `providers` 均已按用户隔离（`owner_key`）⇒ 运行时缓存必须同口径，
   * 否则同租户两用户的同名模型（窗口/定价/别名）与同一供应商类型的凭据会互相覆盖。
   */
  private caches: Map<string, OwnerCache> = new Map();

  /**
   * `providers.yaml` 的供应商配置。
   *
   * 配置文件本身是**进程级同一份**（不分用户），只有 DB 同步进来的凭据才按用户分桶
   * ⇒ 两者分开存，`getProviderConfig()` 以分桶（DB）优先、YAML 兜底。
   */
  private yamlProviderConfigs: Map<string, ProviderConfig> = new Map();

  /** 正在预热的分桶（防止 refreshDbPricing 自己建桶时再排一次刷新） */
  private preheating: Set<string> = new Set();

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

  /**
   * 当前身份的分桶；首次访问时创建并种子化。
   *
   * - 本地身份（桌面 / CLI / 无请求作用域）：启动期已由 `loadModelsFromDb`/`loadDefaultModels`
   *   装载 ⇒ 这里只建空桶，行为与改造前一致；
   * - 已认证身份（同租户的另一用户）：桶为空 ⇒ 先用 YAML 兜底（与启动期"DB 为空"同一分支），
   *   再异步从 DB 补真实定义/定价（DB 仍是唯一事实来源；此处仅预热缓存）。
   */
  private cache(): OwnerCache {
    const owner = getRequestPrincipalKey();
    const existing = this.caches.get(owner);
    if (existing) return existing;

    const created = createOwnerCache();
    this.caches.set(owner, created);
    if (isLocalPrincipal()) return created;

    // 退出登录 / 删租户时摘掉分桶（与其余按身份缓存的模块同一登记口）
    registerScopedResource(owner, () => {
      this.caches.delete(owner);
    });
    this.seedDefaultModels(created);
    if (this.preheating.has(owner)) return created;
    this.preheating.add(owner);
    void this.refreshDbPricing()
      .catch((err: unknown) => {
        logger.warn('registry:新身份缓存预热失败（下次读取会再触发刷新）', {
          owner,
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        this.preheating.delete(owner);
      });
    return created;
  }

  /** 把 YAML 默认模型写入指定分桶（不推送窗口缓存，由调用方决定时机） */
  private seedDefaultModels(target: OwnerCache): void {
    const data = loadDefaultModels();
    for (const [key, entry] of Object.entries(data.models)) {
      target.builtinModels.set(key, yamlEntryToModelConfig(entry, key));
    }
  }

  /**
   * B14b（甲′）：把**当前身份分桶**的模型窗口同步推入 infra 缓存（幂等，覆盖写）。
   * ⚠️ 必须覆盖**两张表**：`builtinModels`（DB/YAML）+ `userModels`（用户配置覆盖），
   * 且 user 在后 ⇒ 与 `getModel()` 的"用户覆盖优先"语义一致（否则用户配置的
   * `contextWindow` 会被漏掉，导致同步路径回落默认值）。
   * ⚠️ 只推当前分桶：窗口缓存同样按所有者分桶，推别人的会串号。
   */
  private _pushWindowsToCache(): void {
    const cache = this.cache();
    for (const [id, cfg] of cache.discoveredModels) {
      setModelWindow(id, cfg.contextWindow);
    }
    for (const [id, cfg] of cache.builtinModels) {
      setModelWindow(id, cfg.contextWindow);
    }
    for (const [id, cfg] of cache.userModels) {
      setModelWindow(id, cfg.contextWindow);
    }
  }

  private constructor() {
    // 启动时通过 loadDefaultModels + loadDbPricing 初始化
  }

  static getInstance(): ModelRegistry {
    if (!ModelRegistry.instance) {
      ModelRegistry.instance = new ModelRegistry();
    }
    return ModelRegistry.instance;
  }

  /** 仅测试：清空全部所有者分桶（不碰 DB / YAML 文件） */
  static resetCacheForTest(): void {
    ModelRegistry.instance?.caches.clear();
    ModelRegistry.instance?.yamlProviderConfigs.clear();
    ModelRegistry.instance?.preheating.clear();
  }

  /** 从 YAML 加载内置默认模型（兜底：仅 DB 无数据时使用） */
  loadDefaultModels(): void {
    this.seedDefaultModels(this.cache());
    this._pushWindowsToCache();
  }

  /**
   * 从 DB（model_registry 表）加载模型定义
   * @returns true 表示成功从 DB 加载了数据，false 表示 DB 为空
   */
  async loadModelsFromDb(): Promise<boolean> {
    const { modelPricingService } = await import('@modules/ai');
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

    this.cache().builtinModels = dbModels;
    this.cache().modelAliasIndex = buildModelAliasIndex(all);
    this._pushWindowsToCache();
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
      const { modelPricingService } = await import('@modules/ai');
      await modelPricingService.initialize();
      const all = await modelPricingService.getAllPricing();
      const scopedPricing = new Map<string, PricingEntry>();
      for (const rec of all) {
        scopedPricing.set(rec.modelId, {
          inputPer1M: rec.inputCostPerMillion,
          outputPer1M: rec.outputCostPerMillion,
          billingMode: rec.billingMode,
          pricePerRequest: rec.pricePerRequest,
          timeBasedPricing: rec.timeBasedPricing,
        });
      }
      // 整桶替换：只覆盖**当前身份**的定价，别的用户分桶不受影响
      this.cache().dbPricing = scopedPricing;
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
    const cache = this.cache();

    // providers.yaml 是进程级同一份配置（不分用户）⇒ 进全局表，DB 凭据按用户分桶覆盖它
    for (const [id, cfg] of Object.entries(providersCfg.providers)) {
      this.yamlProviderConfigs.set(id, cfg);
    }

    for (const [modelId, override] of Object.entries(modelsCfg.models)) {
      if (override.baseModel && cache.builtinModels.has(override.baseModel)) {
        const base = cache.builtinModels.get(override.baseModel)!;
        cache.userModels.set(modelId, {
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
        const existing = cache.builtinModels.get(modelId);
        cache.userModels.set(modelId, {
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
    this._pushWindowsToCache();
  }

  getAllModels(): ModelConfig[] {
    const cache = this.cache();
    const result = new Map(cache.builtinModels);
    for (const [id, cfg] of cache.userModels) result.set(id, cfg);
    for (const [id, cfg] of cache.discoveredModels) {
      if (!result.has(id)) result.set(id, cfg);
    }
    return Array.from(result.values());
  }

  getModel(modelId: string): ModelConfig | undefined {
    const cache = this.cache();
    return (
      cache.userModels.get(modelId) ??
      cache.discoveredModels.get(modelId) ??
      cache.builtinModels.get(modelId)
    );
  }

  getProviderConfig(providerId: string): ProviderConfig | undefined {
    // DB 同步的凭据（按用户）优先，providers.yaml 兜底
    return (
      this.cache().providerConfigs.get(providerId) ??
      this.yamlProviderConfigs.get(providerId)
    );
  }

  /**
   * 运行时注册 Provider 凭据（KB-PROV-FIX，2026-08-28）
   *
   * providerConfigs 原只从 providers.yaml 加载；DB 同步的 Provider（DeepSeek/
   * SiliconFlow 等）在 syncDBProvidersToRegistry 时把 apiKey/baseUrl 写入这里，
   * 使 OpenAIProvider 构造时 resolveApiKey()/resolveBaseUrl() 能取到 DB 值
   * （DB 是唯一事实来源，避免空 key 或回退默认 baseUrl 导致连接失败）。
   */
  setProviderConfig(providerId: string, cfg: Partial<ProviderConfig>): void {
    const configs = this.cache().providerConfigs;
    const existing =
      configs.get(providerId) ?? this.yamlProviderConfigs.get(providerId) ?? {};
    configs.set(providerId, {
      ...existing,
      ...cfg,
    } as ProviderConfig);
  }

  getAllProviderConfigs(): Map<string, ProviderConfig> {
    // YAML 打底，DB 凭据（当前用户）覆盖
    const result = new Map(this.yamlProviderConfigs);
    for (const [id, cfg] of this.cache().providerConfigs) result.set(id, cfg);
    return result;
  }

  discoverModel(modelId: string, config: Partial<ModelConfig>): void {
    this.cache().discoveredModels.set(modelId, {
      firstParty: modelId,
      displayName: modelId,
      contextWindow: 200000,
      maxOutputTokens: 4096,
      ...config,
    } as ModelConfig);
  }

  /** 根据模型名查询内置键名 */
  getModelKeyByName(modelName: string): string | null {
    for (const [key, config] of this.cache().builtinModels) {
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
    const config = this.cache().builtinModels.get(modelKey);
    if (!config) return '';
    return (config as unknown as Record<string, string>)[provider] || '';
  }

  /** 获取指定提供商的模型列表 */
  getModelsByProvider(provider: APIProvider): string[] {
    const result: string[] = [];
    for (const [key, config] of this.cache().builtinModels) {
      if ((config as unknown as Record<string, string>)[provider]) {
        result.push(key);
      }
    }
    return result;
  }

  /** 以 Record 形式返回所有模型（用于向后兼容 ALL_MODEL_CONFIGS） */
  getAllModelsAsRecord(): Record<string, ModelConfig> {
    const cache = this.cache();
    const result: Record<string, ModelConfig> = {};
    for (const [key, config] of cache.builtinModels) {
      result[key] = config;
    }
    for (const [key, config] of cache.userModels) {
      result[key] = config;
    }
    for (const [key, config] of cache.discoveredModels) {
      if (!result[key]) result[key] = config;
    }
    return result;
  }

  /**
   * 解析 wire 别名 → 规范 modelId（`model_registry.provider_mappings` 反查）
   *
   * 非别名（含未加载到注册表的模型）**原样返回**，不做任何猜测。
   * 用途：用量/成本落盘前的模型名归一（否则供应商 wire 名会被当成独立模型记一档）。
   */
  resolveModelAlias(modelName: string): string {
    if (!modelName) return modelName;
    return (
      this.cache().modelAliasIndex.get(modelName.toLowerCase()) ?? modelName
    );
  }

  /** 获取模型在指定提供商的字段值 */
  getProviderField(modelKey: string, provider: APIProvider): string {
    const cache = this.cache();
    const config =
      cache.builtinModels.get(modelKey) ??
      cache.userModels.get(modelKey) ??
      cache.discoveredModels.get(modelKey);
    if (!config) return '';
    return (config as unknown as Record<string, string>)[provider] || '';
  }

  /** DB 定价缓存条目（含计费模式/按次/分时） */
  getModelPricing(modelName: string): PricingEntry | null {
    // DB 定价是唯一来源，不再 fallback 到 YAML
    // 避免"DB 删除后仍能读到 YAML 旧价"的混淆
    return this.cache().dbPricing.get(modelName) || null;
  }

  /** 异步获取模型定价 — 从 DB 实时查询（更精确，例如用于计费） */
  async getModelPricingAsync(modelName: string): Promise<PricingEntry | null> {
    try {
      const { modelPricingService } = await import('@modules/ai');
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
      const beforeIds = new Set(this.cache().builtinModels.keys());
      await this.loadModelsFromDb();
      await this.loadDbPricing();
      this.refreshDoneSeq = seq; // 标记本序号已完成（用于计算后续请求的 queueDepth）
      const afterIds = new Set(this.cache().builtinModels.keys());
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
