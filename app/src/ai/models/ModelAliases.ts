/**
 * 模型别名定义
 */

import { ALL_MODEL_CONFIGS, getModelKeyByName } from './ModelConfigs.js';

/**
 * 模型别名列表
 */
export const MODEL_ALIASES = [
  'best',
  'fast',
  'pro',
  'flash',
] as const;

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
 * @param alias 模型别名
 * @returns 实际模型名称
 */
export function parseModelAlias(alias: ModelAlias): string {
  switch (alias) {
    case 'best':
      return 'deepseek-chat';
    case 'fast':
      return 'deepseek-v4-flash';
    case 'pro':
      return 'deepseek-v4-pro';
    case 'flash':
      return 'deepseek-v4-flash';
    default:
      return alias;
  }
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
  if (lowerModel.includes('flash') || lowerModel.includes('mini') || lowerModel.includes('turbo')) {
    return 'fast';
  }

  return null;
}

/**
 * 检查模型是否支持1M上下文
 * 优先从 ModelConfig 的 extendedContextWindows 读取，回退到旧版字符串匹配
 * @param modelName 模型名称
 * @returns 是否支持1M上下文
 */
export function supports1MContext(modelName: string): boolean {
  const lowerModel = modelName.toLowerCase();
  if (!lowerModel.includes('opus-4') && !lowerModel.includes('sonnet-4')) {
    return false;
  }
  const modelKey = getModelKeyByName(modelName);
  if (modelKey) {
    const config = ALL_MODEL_CONFIGS[modelKey];
    if (config.extendedContextWindows) {
      return config.extendedContextWindows.some((w) => w.suffix === '1m');
    }
  }
  return true;
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
