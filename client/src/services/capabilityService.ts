/**
 * 模型能力管理服务层
 *
 * 提供能力定义的 CRUD 操作、任务映射管理、能力验证等功能。
 * 采用缓存策略：首次请求后缓存，后台静默刷新。
 */

import { httpLegacy as http } from "./httpClient";
import { ENDPOINTS } from "./endpoints";
import { handleClientError } from "../utils/handleError";

/** 能力定义接口 */
export interface ModelCapabilityDefinition {
  key: string;
  /**
   * 分类键（如 `core` / `vision`）。
   *
   * 2026-10-16（台账 `CAPS-CATEGORY-LABEL-SINGLE-SOURCE`）：原为本地 `CapabilityCategory` 枚举 ——
   * 那是**客户端第二份分类键集声明**（真源在服务端 `CATEGORY_ORDER`）⇒ 已删，改为 `string`：
   * 分类列表由 `/v1/capabilities` 下发，客户端不需要也不应再枚举一遍。
   */
  category: string;
  labelKey: string;
  /**
   * 能力描述 key。
   *
   * ⚠️ **当前无客户端消费者**（2026-10-16 台账 `CAPS-CAPABILITY-LABEL-CONVENTION` reopenWhen ③）：
   * 描述走 `getDescription()` 的 `${labelKey}Desc` **扁平**形态（原因见该方法注释：i18next 的
   * `labelKey` 叶子字符串与 `labelKey.desc` 嵌套路径冲突）；而服务端播种值与 DB 存量值是这个
   * **嵌套**形态（`capability.<x>.desc`）。⇒ 若日后要改用它，**必须同时**在 locale 里补出嵌套键，
   * 否则又是一次「键写对了但解析不到」（与 labelKey 前缀问题同源）。
   */
  descriptionKey: string;
  labelFallback: string;
  descriptionFallback: string;
  isDefault: boolean;
  enabled: boolean;
  taskTypes: string[];
  sortOrder: number;
  sinceVersion?: string;
  deprecatedSince?: string;
  dependencies: string[];
  version: number;
}

/** 分类定义接口 */
export interface CapabilityCategoryDefinition {
  key: string;
  labelKey: string;
  sortOrder: number;
}

/** 任务-能力映射 */
export interface TaskCapabilityMapping {
  taskType: string;
  requiredCapabilities: string[];
  optionalCapabilities: string[];
  sortOrder: number;
}

/** 验证问题 */
export interface ValidationIssue {
  type: string;
  taskType?: string;
  modelId?: string;
  capability?: string;
  dependency?: string;
  requiredCapability?: string[];
  optionalCapabilities?: string[];
  message: string;
}

/** 缓存数据 */
interface CapabilityCache {
  capabilities: ModelCapabilityDefinition[];
  categories: CapabilityCategoryDefinition[];
  version: string;
  lastUpdated: number;
}

let cache: CapabilityCache | null = null;
const CAPABILITY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟

/** 获取缓存的能力列表 */
function getCachedCapabilities(): ModelCapabilityDefinition[] {
  if (!cache || Date.now() - cache.lastUpdated > CAPABILITY_CACHE_TTL_MS) {
    return [];
  }
  return cache.capabilities;
}

/** 获取缓存的分类列表 */
function getCachedCategories(): CapabilityCategoryDefinition[] {
  if (!cache || Date.now() - cache.lastUpdated > CAPABILITY_CACHE_TTL_MS) {
    return [];
  }
  return cache.categories;
}

export const capabilityService = {
  /**
   * 获取能力列表（支持过滤）
   * @param params 过滤参数
   * @returns 能力列表和分类信息
   */
  async getAll(params?: { category?: string; enabled?: boolean }): Promise<{
    capabilities: ModelCapabilityDefinition[];
    categories: CapabilityCategoryDefinition[];
    version: string;
    lastModified: string;
  }> {
    const url = new URL(ENDPOINTS.models.capabilities, window.location.origin);
    if (params?.category) {
      url.searchParams.set("category", params.category);
    }
    if (params?.enabled !== undefined) {
      url.searchParams.set("enabled", String(params.enabled));
    }

    const res = await http.get<{
      data: {
        capabilities: ModelCapabilityDefinition[];
        categories: CapabilityCategoryDefinition[];
        version: string;
        lastModified: string;
      };
    }>(url.pathname + url.search);

    const data = res.data;

    cache = {
      capabilities: data.capabilities,
      categories: data.categories,
      version: data.version,
      lastUpdated: Date.now(),
    };

    return data;
  },

  /**
   * 获取单个能力详情
   * @param key 能力唯一标识
   * @returns 能力定义或 null
   */
  async get(key: string): Promise<ModelCapabilityDefinition | null> {
    try {
      const res = await http.get<{ data: ModelCapabilityDefinition }>(
        ENDPOINTS.models.capabilityByKey(key),
      );
      return res.data;
    } catch (e) {
      handleClientError(e, { module: "services:capability", action: "get" });
      return null;
    }
  },

  /**
   * 创建新能力
   * @param definition 能力定义
   */
  async create(
    definition: Omit<ModelCapabilityDefinition, "version">,
  ): Promise<void> {
    await http.post(ENDPOINTS.models.capabilities, definition);
    // 清除缓存
    cache = null;
  },

  /**
   * 更新能力定义
   * @param key 能力唯一标识
   * @param updates 更新内容
   */
  async update(
    key: string,
    updates: Partial<Omit<ModelCapabilityDefinition, "key">>,
  ): Promise<void> {
    await http.put(ENDPOINTS.models.capabilityByKey(key), updates);
    // 清除缓存
    cache = null;
  },

  /**
   * 删除能力（软删除）
   * @param key 能力唯一标识
   */
  async delete(key: string): Promise<void> {
    await http.delete(ENDPOINTS.models.capabilityByKey(key));
    // 清除缓存
    cache = null;
  },

  /**
   * 批量创建/更新能力
   * @param data 能力定义数组
   */
  async batch(data: ModelCapabilityDefinition[]): Promise<void> {
    await http.post(ENDPOINTS.models.capabilitiesBatch, { data });
    // 清除缓存
    cache = null;
  },

  /**
   * 获取任务-能力映射列表
   * @returns 任务映射列表
   */
  async getTaskMappings(): Promise<TaskCapabilityMapping[]> {
    const res = await http.get<{ data: TaskCapabilityMapping[] }>(
      ENDPOINTS.models.capabilitiesTaskMappings,
    );
    return res.data;
  },

  /**
   * 更新任务-能力映射
   * @param mappings 任务映射数组
   */
  async updateTaskMappings(mappings: TaskCapabilityMapping[]): Promise<void> {
    await http.put(ENDPOINTS.models.capabilitiesTaskMappings, {
      data: mappings,
    });
  },

  /**
   * 获取分类列表
   * @returns 分类列表
   */
  async getCategories(): Promise<CapabilityCategoryDefinition[]> {
    const res = await http.get<{ data: CapabilityCategoryDefinition[] }>(
      ENDPOINTS.models.capabilitiesCategories,
    );
    return res.data;
  },

  /**
   * 验证模型能力配置
   * @param taskType 任务类型
   * @param modelCapabilities 模型具备的能力列表
   * @returns 验证结果
   */
  async validate(
    taskType: string,
    modelCapabilities: string[],
  ): Promise<{ valid: boolean; issues: ValidationIssue[] }> {
    const res = await http.post<{
      data: { valid: boolean; issues: ValidationIssue[] };
    }>(ENDPOINTS.models.capabilitiesValidate, {
      taskType,
      modelCapabilities,
    });
    return res.data;
  },

  /**
   * 获取缓存的能力列表（优先使用缓存）
   * @param forceRefresh 是否强制刷新
   * @returns 能力列表
   */
  async getCapabilitiesCached(
    forceRefresh = false,
  ): Promise<ModelCapabilityDefinition[]> {
    const cached = getCachedCapabilities();
    if (cached.length > 0 && !forceRefresh) {
      return cached;
    }

    const result = await this.getAll();
    return result?.capabilities || [];
  },

  /**
   * 获取缓存的分类列表（优先使用缓存）
   * @param forceRefresh 是否强制刷新
   * @returns 分类列表
   */
  async getCategoriesCached(
    forceRefresh = false,
  ): Promise<CapabilityCategoryDefinition[]> {
    // 如果有有效缓存且不强制刷新，直接返回缓存
    const cached = getCachedCategories();
    if (cached.length > 0 && !forceRefresh) {
      return cached;
    }

    // 否则从服务器获取
    const result = await this.getAll();
    return result.categories;
  },

  /**
   * 获取能力的显示名称（国际化 fallback）
   * @param capability 能力定义
   * @param t 翻译函数（可选）
   * @returns 显示名称
   */
  getDisplayName(
    capability: ModelCapabilityDefinition,
    t?: (key: string) => string,
  ): string {
    if (t) {
      const translated = t(capability.labelKey);
      // 如果翻译结果和 key 相同，说明没有找到翻译
      if (translated !== capability.labelKey) {
        return translated;
      }
    }
    return capability.labelFallback;
  },

  /**
   * 获取能力的描述（国际化 fallback）
   * @param capability 能力定义
   * @param t 翻译函数（可选）
   * @returns 描述文本
   */
  getDescription(
    capability: ModelCapabilityDefinition,
    t?: (key: string) => string,
  ): string {
    if (t) {
      // desc 用扁平键 labelKey+Desc（i18next 叶子字符串与 .desc 嵌套路径冲突，
      // 统一以 labelKeyDesc 形态注册于 i18n 资源）
      const flatKey = `${capability.labelKey}Desc`;
      const translated = t(flatKey);
      if (translated !== flatKey) {
        return translated;
      }
    }
    return capability.descriptionFallback;
  },

  /**
   * 获取分类的显示名称
   *
   * 真源：**服务端下发的 `category.labelKey`**（= `capability.category.<key>`）+ 客户端 i18n。
   * 2026-10-16（台账 `CAPS-CATEGORY-LABEL-SINGLE-SOURCE`）：删除原先的**硬编码中文兜底表** ——
   * 它既是重复声明，又让非中文界面退回中文（且掩盖了 labelKey 前缀失效的真问题）。
   * 现约定：i18n 未命中 ⇒ 原样返回分类键（可诊断，不再是"看着对但语言错"的文本）。
   *
   * @param category 分类定义（含服务端下发的 labelKey）
   * @param t 翻译函数（可选；不传则直接返回分类键）
   */
  getCategoryDisplayName(
    category: CapabilityCategoryDefinition,
    t?: (key: string) => string,
  ): string {
    if (t) {
      const translated = t(category.labelKey);
      if (translated !== category.labelKey) {
        return translated;
      }
    }
    return category.key;
  },

  /**
   * 按分类键解析显示名（各 UI 的**唯一**入口）。
   *
   * 存在的意义：组件常只持有分类键（分组结果的 key），而不是分类定义对象。
   * 分类定义列表（含服务端 labelKey）由 `/v1/capabilities` 下发 ⇒ 这里查表 + 委派给
   * {@link getCategoryDisplayName}，**避免各组件各自复制 i18n 键约定或中文标签表**
   * （此前 `CapabilitySelector` 的 `CATEGORY_NAME_KEYS`、`ModelMetaEditor` 的
   * `known` 数组 + 私有 `t('capability.category.' + key)` 即为此类副本）。
   *
   * @param categories 分类定义列表（服务端下发）
   * @param key 分类键
   * @param t 翻译函数（可选）
   * @returns 显示名；列表里查不到 ⇒ 原样返回分类键
   */
  getCategoryDisplayNameByKey(
    categories: CapabilityCategoryDefinition[],
    key: string,
    t?: (key: string) => string,
  ): string {
    const category = categories.find((c) => c.key === key);
    return category ? this.getCategoryDisplayName(category, t) : key;
  },
};
