/**
 * 模型别名定义
 * 参考CC源码: cc_code/backend/utils/model/aliases.ts
 */

/**
 * 模型别名列表
 */
export const MODEL_ALIASES = [
  'sonnet',
  'opus',
  'haiku',
  'best',
  'sonnet[1m]',
  'opus[1m]',
] as const;

/**
 * 模型别名类型
 */
export type ModelAlias = (typeof MODEL_ALIASES)[number];

/**
 * 模型家族别名列表
 */
export const MODEL_FAMILY_ALIASES = ['sonnet', 'opus', 'haiku'] as const;

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
    case 'sonnet':
      return 'claude-sonnet-4-6-20250219';
    case 'opus':
      return 'claude-opus-4-6-20250219';
    case 'haiku':
      return 'claude-3-5-haiku-20241022';
    case 'best':
      return 'claude-opus-4-6-20250219';
    case 'sonnet[1m]':
      return 'claude-sonnet-4-6-20250219';
    case 'opus[1m]':
      return 'claude-opus-4-6-20250219';
    default:
      return alias;
  }
}

/**
 * 获取模型家族
 * @param modelName 模型名称
 * @returns 模型家族
 */
export function getModelFamily(modelName: string): ModelFamilyAlias | null {
  const lowerModel = modelName.toLowerCase();
  
  if (lowerModel.includes('opus')) {
    return 'opus';
  }
  if (lowerModel.includes('sonnet')) {
    return 'sonnet';
  }
  if (lowerModel.includes('haiku')) {
    return 'haiku';
  }
  
  return null;
}

/**
 * 检查模型是否支持1M上下文
 * @param modelName 模型名称
 * @returns 是否支持1M上下文
 */
export function supports1MContext(modelName: string): boolean {
  const lowerModel = modelName.toLowerCase();
  return lowerModel.includes('opus-4') || lowerModel.includes('sonnet-4');
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
