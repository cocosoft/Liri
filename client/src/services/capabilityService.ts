/**
 * 模型能力管理服务层
 * 
 * 提供能力定义的 CRUD 操作、任务映射管理、能力验证等功能。
 * 采用缓存策略：首次请求后缓存，后台静默刷新。
 */

import { httpLegacy as http } from "./httpClient";

/** 能力分类 */
export enum CapabilityCategory {
  CORE = 'core',
  VISION = 'vision',
  MEDIA = 'media',
  TOOLS = 'tools',
  SPECIAL = 'special',
}

/** 能力定义接口 */
export interface ModelCapabilityDefinition {
  key: string;
  category: CapabilityCategory;
  labelKey: string;
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
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟

/** 获取缓存的能力列表 */
function getCachedCapabilities(): ModelCapabilityDefinition[] {
  if (!cache || Date.now() - cache.lastUpdated > CACHE_TTL) {
    return [];
  }
  return cache.capabilities;
}

/** 获取缓存的分类列表 */
function getCachedCategories(): CapabilityCategoryDefinition[] {
  if (!cache || Date.now() - cache.lastUpdated > CACHE_TTL) {
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
  async getAll(
    params?: { category?: string; enabled?: boolean }
  ): Promise<{
    capabilities: ModelCapabilityDefinition[];
    categories: CapabilityCategoryDefinition[];
    version: string;
    lastModified: string;
  }> {
    const url = new URL('/v1/models/capabilities', window.location.origin);
    if (params?.category) {
      url.searchParams.set('category', params.category);
    }
    if (params?.enabled !== undefined) {
      url.searchParams.set('enabled', String(params.enabled));
    }

    const data = await http.get<{
      capabilities: ModelCapabilityDefinition[];
      categories: CapabilityCategoryDefinition[];
      version: string;
      lastModified: string;
    }>(url.pathname + url.search);

    // 更新缓存
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
      return await http.get<ModelCapabilityDefinition>(`/v1/models/capabilities/${encodeURIComponent(key)}`);
    } catch {
      return null;
    }
  },

  /**
   * 创建新能力
   * @param definition 能力定义
   */
  async create(definition: Omit<ModelCapabilityDefinition, 'version'>): Promise<void> {
    await http.post('/v1/models/capabilities', definition);
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
    updates: Partial<Omit<ModelCapabilityDefinition, 'key'>>
  ): Promise<void> {
    await http.put(`/v1/models/capabilities/${encodeURIComponent(key)}`, updates);
    // 清除缓存
    cache = null;
  },

  /**
   * 删除能力（软删除）
   * @param key 能力唯一标识
   */
  async delete(key: string): Promise<void> {
    await http.delete(`/v1/models/capabilities/${encodeURIComponent(key)}`);
    // 清除缓存
    cache = null;
  },

  /**
   * 批量创建/更新能力
   * @param data 能力定义数组
   */
  async batch(data: ModelCapabilityDefinition[]): Promise<void> {
    await http.post('/v1/models/capabilities/batch', { data });
    // 清除缓存
    cache = null;
  },

  /**
   * 获取任务-能力映射列表
   * @returns 任务映射列表
   */
  async getTaskMappings(): Promise<TaskCapabilityMapping[]> {
    return await http.get<TaskCapabilityMapping[]>('/v1/models/capabilities/task-mappings');
  },

  /**
   * 更新任务-能力映射
   * @param mappings 任务映射数组
   */
  async updateTaskMappings(mappings: TaskCapabilityMapping[]): Promise<void> {
    await http.put('/v1/models/capabilities/task-mappings', { data: mappings });
  },

  /**
   * 获取分类列表
   * @returns 分类列表
   */
  async getCategories(): Promise<CapabilityCategoryDefinition[]> {
    return await http.get<CapabilityCategoryDefinition[]>('/v1/models/capabilities/categories');
  },

  /**
   * 验证模型能力配置
   * @param taskType 任务类型
   * @param modelCapabilities 模型具备的能力列表
   * @returns 验证结果
   */
  async validate(
    taskType: string,
    modelCapabilities: string[]
  ): Promise<{ valid: boolean; issues: ValidationIssue[] }> {
    return await http.post<{ valid: boolean; issues: ValidationIssue[] }>('/v1/models/capabilities/validate', {
      taskType,
      modelCapabilities,
    });
  },

  /**
   * 获取缓存的能力列表（优先使用缓存）
   * @param forceRefresh 是否强制刷新
   * @returns 能力列表
   */
  async getCapabilitiesCached(forceRefresh = false): Promise<ModelCapabilityDefinition[]> {
    // 如果有有效缓存且不强制刷新，直接返回缓存
    const cached = getCachedCapabilities();
    if (cached.length > 0 && !forceRefresh) {
      return cached;
    }

    // 否则从服务器获取
    const result = await this.getAll();
    return result.capabilities;
  },

  /**
   * 获取缓存的分类列表（优先使用缓存）
   * @param forceRefresh 是否强制刷新
   * @returns 分类列表
   */
  async getCategoriesCached(forceRefresh = false): Promise<CapabilityCategoryDefinition[]> {
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
    t?: (key: string) => string
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
    t?: (key: string) => string
  ): string {
    if (t) {
      const translated = t(capability.descriptionKey);
      if (translated !== capability.descriptionKey) {
        return translated;
      }
    }
    return capability.descriptionFallback;
  },

  /**
   * 获取分类的显示名称
   * @param category 分类定义
   * @param t 翻译函数（可选）
   * @returns 显示名称
   */
  getCategoryDisplayName(
    category: CapabilityCategoryDefinition,
    t?: (key: string) => string
  ): string {
    if (t) {
      const translated = t(category.labelKey);
      if (translated !== category.labelKey) {
        return translated;
      }
    }
    // 提供默认的分类显示名称映射
    const fallbackNames: Record<string, string> = {
      [CapabilityCategory.CORE]: '核心能力',
      [CapabilityCategory.VISION]: '视觉能力',
      [CapabilityCategory.MEDIA]: '媒体能力',
      [CapabilityCategory.TOOLS]: '工具能力',
      [CapabilityCategory.SPECIAL]: '特殊能力',
    };
    return fallbackNames[category.key] || category.key;
  },
};
