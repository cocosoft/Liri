/**
 * 模型别名定义
 */

import { ALL_MODEL_CONFIGS, getModelKeyByName } from './ModelConfigs.js';
import { ModelRegistry } from './ModelRegistry.js';

/** 非聊天能力标签（用于排除专用模型） */
const NON_CHAT_CAPABILITIES = new Set([
  'image_generation',
  'video_generation',
  'embedding',
  'text_to_speech',
  'speech_recognition',
  'reranking',
  'moderation',
  'image_editing',
  'text_to_video',
  'image_to_video',
]);

/** 高性能模型名称关键词 */
const BEST_KEYWORDS = ['pro', 'reasoner', 'opus', 'preview', 'max'];

/** 轻量/快速模型名称关键词 */
const FAST_KEYWORDS = ['flash', 'mini', 'turbo', 'haiku', 'nano', 'lite'];

/**
 * 从 ModelRegistry 同步查询最匹配的模型
 *
 * 根据别名语义（best=最强推理, fast=轻量快速）从已注册模型中筛选。
 * ModelRegistry 是启动时从 DB 加载的内存缓存，可同步访问。
 *
 * @param alias 模型别名
 * @returns 实际模型名，或 fallback 到通用占位符
 */
export function resolveModelAliasFromRegistry(alias: ModelAlias): string {
  try {
    const registry = ModelRegistry.getInstance();
    const allModels = registry.getAllModels();

    // 筛选纯聊天模型（无专用能力的模型）
    const chatModels = allModels.filter((m) => {
      const caps = m.capabilities || [];
      return (
        caps.length === 0 || !caps.every((c) => NON_CHAT_CAPABILITIES.has(c))
      );
    });

    if (chatModels.length === 0) return fallbackFor(alias);

    if (alias === 'best' || alias === 'pro') {
      // 优先级：名称含 pro/reasoner/opus > 最大 contextWindow > 第一个
      const best = chatModels.find((m) =>
        BEST_KEYWORDS.some((kw) => m.firstParty.toLowerCase().includes(kw))
      );
      if (best) return best.firstParty;

      // 按 contextWindow 降序取最大
      const sorted = [...chatModels].sort(
        (a, b) => (b.contextWindow || 0) - (a.contextWindow || 0)
      );
      return sorted[0].firstParty;
    }

    if (alias === 'fast' || alias === 'flash') {
      // 优先级：名称含 flash/mini/turbo > 最小 contextWindow > 第一个
      const fast = chatModels.find((m) =>
        FAST_KEYWORDS.some((kw) => m.firstParty.toLowerCase().includes(kw))
      );
      if (fast) return fast.firstParty;

      // 按 contextWindow 升序取最小（越便宜通常窗口越小）
      const sorted = [...chatModels].sort(
        (a, b) => (a.contextWindow || 0) - (b.contextWindow || 0)
      );
      return sorted[0].firstParty;
    }

    return fallbackFor(alias);
  } catch {
    // ModelRegistry 不可用时回退到原有行为
    return fallbackFor(alias);
  }
}

/** 无法从 registry 解析时的兜底占位符 */
function fallbackFor(alias: ModelAlias): string {
  switch (alias) {
    case 'best':
    case 'pro':
      return 'default-pro';
    case 'fast':
    case 'flash':
      return 'default-fast';
    default:
      return alias;
  }
}

/**
 * 模型别名列表
 */
export const MODEL_ALIASES = ['best', 'fast', 'pro', 'flash'] as const;

/**
 * 模型别名类型
 */
export type ModelAlias = (typeof MODEL_ALIASES)[number];

/**
 * 模型家族别名列表
 */
export const MODEL_FAMILY_ALIASES = ['best', 'fast'] as const;

/**
 * 模型家族别名类型
 */
export type ModelFamilyAlias = (typeof MODEL_FAMILY_ALIASES)[number];

/**
 * 检查是否为模型别名
 * @param modelInput 模型输入
 * @returns 是否为模型别名
 */
export function isModelAlias(modelInput: string): modelInput is ModelAlias {
  return MODEL_ALIASES.includes(modelInput as ModelAlias);
}

/**
 * 检查是否为模型家族别名
 * @param model 模型名称
 * @returns 是否为模型家族别名
 */
export function isModelFamilyAlias(model: string): boolean {
  return MODEL_FAMILY_ALIASES.includes(model as ModelFamilyAlias);
}

/**
 * 解析模型别名
 *
 * 从 ModelRegistry（DB 内存缓存）中按别名语义查询实际模型名。
 * best/pro → 高能力推理模型；fast/flash → 轻量快速模型。
 * ModelRegistry 为空时回退到通用占位符（default-pro/default-fast），
 * 由 ModelRouter 按任务分工进一步路由。
 *
 * @param alias 模型别名
 * @returns 实际模型名称或通用别名
 */
export function parseModelAlias(alias: ModelAlias): string {
  return resolveModelAliasFromRegistry(alias);
}

/**
 * 获取模型家族（基于提供商关键词匹配）
 * @param modelName 模型名称
 * @returns 模型家族
 */
export function getModelFamily(modelName: string): ModelFamilyAlias | null {
  const lowerModel = modelName.toLowerCase();

  if (lowerModel.includes('pro') || lowerModel.includes('reasoner')) {
    return 'best';
  }
  if (
    lowerModel.includes('flash') ||
    lowerModel.includes('mini') ||
    lowerModel.includes('turbo')
  ) {
    return 'fast';
  }

  return null;
}

/**
 * 检查模型是否支持扩展上下文
 * 从 ModelConfig 的 extendedContextWindows 读取。
 * @param modelName 模型名称
 * @returns 是否支持扩展上下文
 */
export function supports1MContext(modelName: string): boolean {
  const modelKey = getModelKeyByName(modelName);
  if (modelKey) {
    const config = ALL_MODEL_CONFIGS[modelKey];
    if (config.extendedContextWindows) {
      return config.extendedContextWindows.some((w) => w.suffix === '1m');
    }
  }
  // 无法从配置判断时，保守返回 false
  return false;
}

/**
 * 检查模型是否有1M后缀
 * @param modelName 模型名称
 * @returns 是否有1M后缀
 */
export function has1MSuffix(modelName: string): boolean {
  return modelName.includes('[1m]');
}

/**
 * 移除1M后缀
 * @param modelName 模型名称
 * @returns 移除后的模型名称
 */
export function remove1MSuffix(modelName: string): string {
  return modelName.replace('[1m]', '').trim();
}

/**
 * 添加1M后缀
 * @param modelName 模型名称
 * @returns 添加后的模型名称
 */
export function add1MSuffix(modelName: string): string {
  if (has1MSuffix(modelName)) {
    return modelName;
  }
  return `${modelName}[1m]`;
}
