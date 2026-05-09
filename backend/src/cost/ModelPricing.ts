/**
 * 模型定价配置
 * 定义不同模型的定价信息，参考CC源码的成本层级设计
 */

/**
 * 模型定价配置
 */
export interface ModelPricing {
  /** 输入令牌价格（每百万令牌的美元价格） */
  inputPricePerMillion: number;
  /** 输出令牌价格（每百万令牌的美元价格） */
  outputPricePerMillion: number;
  /** 缓存读取令牌价格（每百万令牌的美元价格） */
  cacheReadPricePerMillion: number;
  /** 缓存创建令牌价格（每百万令牌的美元价格） */
  cacheCreationPricePerMillion: number;
  /** 网络搜索请求价格（每次请求的美元价格） */
  webSearchPricePerRequest: number;
  /** 快速模式定价配置（可选） */
  fastModePricing?: ModelPricing;
}

/**
 * 成本层级 - 标准Sonnet层级: $3输入 / $15输出每百万令牌
 */
export const COST_TIER_3_15: ModelPricing = {
  inputPricePerMillion: 3,
  outputPricePerMillion: 15,
  cacheReadPricePerMillion: 0.3,
  cacheCreationPricePerMillion: 3.75,
  webSearchPricePerRequest: 0.01,
};

/**
 * 成本层级 - Opus 4/4.1层级: $15输入 / $75输出每百万令牌
 */
export const COST_TIER_15_75: ModelPricing = {
  inputPricePerMillion: 15,
  outputPricePerMillion: 75,
  cacheReadPricePerMillion: 1.5,
  cacheCreationPricePerMillion: 18.75,
  webSearchPricePerRequest: 0.01,
};

/**
 * 成本层级 - Opus 4.5层级: $5输入 / $25输出每百万令牌
 */
export const COST_TIER_5_25: ModelPricing = {
  inputPricePerMillion: 5,
  outputPricePerMillion: 25,
  cacheReadPricePerMillion: 0.5,
  cacheCreationPricePerMillion: 6.25,
  webSearchPricePerRequest: 0.01,
};

/**
 * 成本层级 - Opus 4.6快速模式层级: $30输入 / $150输出每百万令牌
 */
export const COST_TIER_30_150: ModelPricing = {
  inputPricePerMillion: 30,
  outputPricePerMillion: 150,
  cacheReadPricePerMillion: 3,
  cacheCreationPricePerMillion: 37.5,
  webSearchPricePerRequest: 0.01,
};

/**
 * 成本层级 - Haiku 3.5层级: $0.80输入 / $4输出每百万令牌
 */
export const COST_HAIKU_35: ModelPricing = {
  inputPricePerMillion: 0.8,
  outputPricePerMillion: 4,
  cacheReadPricePerMillion: 0.08,
  cacheCreationPricePerMillion: 1,
  webSearchPricePerRequest: 0.01,
};

/**
 * 成本层级 - Haiku 4.5层级: $1输入 / $5输出每百万令牌
 */
export const COST_HAIKU_45: ModelPricing = {
  inputPricePerMillion: 1,
  outputPricePerMillion: 5,
  cacheReadPricePerMillion: 0.1,
  cacheCreationPricePerMillion: 1.25,
  webSearchPricePerRequest: 0.01,
};

/**
 * 默认未知模型成本层级
 */
const DEFAULT_UNKNOWN_MODEL_COST = COST_TIER_5_25;

/**
 * 模型名称到标准名称映射
 */
export const MODEL_ALIASES: Record<string, string> = {
  // Anthropic Claude 模型别名
  'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku': 'claude-3-5-haiku-20241022',
  'claude-3-opus': 'claude-3-opus-20240229',
  'claude-3-sonnet': 'claude-3-sonnet-20240229',
  'claude-3-haiku': 'claude-3-haiku-20240307',
  'claude-4-opus': 'claude-opus-4-6',
  'claude-4-sonnet': 'claude-sonnet-4-6',
  'claude-4-haiku': 'claude-haiku-4-5-20251001',
  'claude-4-5-opus': 'claude-opus-4-5-20251101',
  'claude-4-5-sonnet': 'claude-sonnet-4-5-20250929',
  'claude-4-5-haiku': 'claude-haiku-4-5-20251001',
  'claude-4-6-opus': 'claude-opus-4-6',

  // OpenAI GPT 模型别名
  'gpt-4-turbo-preview': 'gpt-4-turbo',
  'gpt-4-1106-preview': 'gpt-4-turbo',
  'gpt-3.5-turbo-16k': 'gpt-3.5-turbo',

  // Google Gemini 模型别名
  'gemini-1.5-pro-latest': 'gemini-1.5-pro',
  'gemini-1.5-flash-latest': 'gemini-1.5-flash',
};

/**
 * 模型定价配置映射
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude 模型 - 3.5系列
  'claude-3-5-sonnet-20241022': COST_TIER_3_15,
  'claude-3-5-sonnet-v2-20241022': COST_TIER_3_15,
  'claude-3-7-sonnet-20250219': COST_TIER_3_15,
  'claude-3-5-haiku-20241022': COST_HAIKU_35,

  // Anthropic Claude 模型 - 3系列
  'claude-3-opus-20240229': COST_TIER_15_75,
  'claude-3-sonnet-20240229': COST_TIER_3_15,
  'claude-3-haiku-20240307': {
    inputPricePerMillion: 0.25,
    outputPricePerMillion: 1.25,
    cacheReadPricePerMillion: 0.03,
    cacheCreationPricePerMillion: 0.3,
    webSearchPricePerRequest: 0.01,
  },

  // Anthropic Claude 模型 - 4系列
  'claude-opus-4-6': COST_TIER_15_75,
  'claude-opus-4-5-20251101': COST_TIER_15_75,
  'claude-opus-4-1-20250805': COST_TIER_15_75,
  'claude-opus-4-20250514': COST_TIER_15_75,
  'claude-sonnet-4-6': COST_TIER_3_15,
  'claude-sonnet-4-5-20250929': COST_TIER_3_15,
  'claude-sonnet-4-20250514': COST_TIER_3_15,
  'claude-haiku-4-5-20251001': COST_HAIKU_45,

  // OpenAI GPT 模型
  'gpt-4o': {
    inputPricePerMillion: 5.0,
    outputPricePerMillion: 15.0,
    cacheReadPricePerMillion: 0.5,
    cacheCreationPricePerMillion: 6.25,
    webSearchPricePerRequest: 0.01,
  },
  'gpt-4o-mini': {
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
    cacheReadPricePerMillion: 0.015,
    cacheCreationPricePerMillion: 0.1875,
    webSearchPricePerRequest: 0.01,
  },
  'gpt-4-turbo': {
    inputPricePerMillion: 10.0,
    outputPricePerMillion: 30.0,
    cacheReadPricePerMillion: 1.0,
    cacheCreationPricePerMillion: 12.5,
    webSearchPricePerRequest: 0.01,
  },
  'gpt-4': {
    inputPricePerMillion: 30.0,
    outputPricePerMillion: 60.0,
    cacheReadPricePerMillion: 3.0,
    cacheCreationPricePerMillion: 37.5,
    webSearchPricePerRequest: 0.01,
  },
  'gpt-3.5-turbo': {
    inputPricePerMillion: 0.5,
    outputPricePerMillion: 1.5,
    cacheReadPricePerMillion: 0.05,
    cacheCreationPricePerMillion: 0.625,
    webSearchPricePerRequest: 0.01,
  },

  // Google Gemini 模型
  'gemini-1.5-pro': {
    inputPricePerMillion: 3.5,
    outputPricePerMillion: 10.5,
    cacheReadPricePerMillion: 0.35,
    cacheCreationPricePerMillion: 4.375,
    webSearchPricePerRequest: 0.01,
  },
  'gemini-1.5-flash': {
    inputPricePerMillion: 0.075,
    outputPricePerMillion: 0.3,
    cacheReadPricePerMillion: 0.0075,
    cacheCreationPricePerMillion: 0.09375,
    webSearchPricePerRequest: 0.01,
  },
  'gemini-2.0-flash': {
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.4,
    cacheReadPricePerMillion: 0.01,
    cacheCreationPricePerMillion: 0.125,
    webSearchPricePerRequest: 0.01,
  },
  'gemini-2.0-pro': {
    inputPricePerMillion: 4.0,
    outputPricePerMillion: 12.0,
    cacheReadPricePerMillion: 0.4,
    cacheCreationPricePerMillion: 5.0,
    webSearchPricePerRequest: 0.01,
  },

  // DeepSeek 模型
  'deepseek-chat': {
    inputPricePerMillion: 0.5,
    outputPricePerMillion: 2.0,
    cacheReadPricePerMillion: 0.05,
    cacheCreationPricePerMillion: 0.625,
    webSearchPricePerRequest: 0.01,
  },
  'deepseek-reasoner': {
    inputPricePerMillion: 2.0,
    outputPricePerMillion: 8.0,
    cacheReadPricePerMillion: 0.2,
    cacheCreationPricePerMillion: 2.5,
    webSearchPricePerRequest: 0.01,
  },

  // Meta Llama 模型
  'meta-llama-3-70b': {
    inputPricePerMillion: 1.0,
    outputPricePerMillion: 1.0,
    cacheReadPricePerMillion: 0.1,
    cacheCreationPricePerMillion: 1.25,
    webSearchPricePerRequest: 0.01,
  },
  'meta-llama-3-8b': {
    inputPricePerMillion: 0.2,
    outputPricePerMillion: 0.2,
    cacheReadPricePerMillion: 0.02,
    cacheCreationPricePerMillion: 0.25,
    webSearchPricePerRequest: 0.01,
  },
  'meta-llama-3-1-405b': {
    inputPricePerMillion: 3.5,
    outputPricePerMillion: 10.5,
    cacheReadPricePerMillion: 0.35,
    cacheCreationPricePerMillion: 4.375,
    webSearchPricePerRequest: 0.01,
  },
  'meta-llama-3-1-70b': {
    inputPricePerMillion: 1.0,
    outputPricePerMillion: 1.0,
    cacheReadPricePerMillion: 0.1,
    cacheCreationPricePerMillion: 1.25,
    webSearchPricePerRequest: 0.01,
  },
  'meta-llama-3-1-8b': {
    inputPricePerMillion: 0.2,
    outputPricePerMillion: 0.2,
    cacheReadPricePerMillion: 0.02,
    cacheCreationPricePerMillion: 0.25,
    webSearchPricePerRequest: 0.01,
  },

  // Azure OpenAI 模型
  'gpt-4o-azure': {
    inputPricePerMillion: 5.0,
    outputPricePerMillion: 15.0,
    cacheReadPricePerMillion: 0.5,
    cacheCreationPricePerMillion: 6.25,
    webSearchPricePerRequest: 0.01,
  },
  'gpt-4o-mini-azure': {
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
    cacheReadPricePerMillion: 0.015,
    cacheCreationPricePerMillion: 0.1875,
    webSearchPricePerRequest: 0.01,
  },

  // AWS Bedrock 模型
  'anthropic.claude-3-5-sonnet-20241022-v2:0': COST_TIER_3_15,
  'anthropic.claude-3-5-haiku-20241022-v1:0': COST_HAIKU_35,
  'anthropic.claude-3-opus-20240229-v1:0': COST_TIER_15_75,
  'anthropic.claude-3-sonnet-20240229-v1:0': COST_TIER_3_15,
  'anthropic.claude-3-haiku-20240307-v1:0': {
    inputPricePerMillion: 0.25,
    outputPricePerMillion: 1.25,
    cacheReadPricePerMillion: 0.03,
    cacheCreationPricePerMillion: 0.3,
    webSearchPricePerRequest: 0.01,
  },
};

/**
 * 未知模型跟踪器
 */
let hasUnknownModelCost: boolean = false;

/**
 * 获取模型的标准名称
 */
export function getCanonicalModelName(modelName: string): string {
  const alias = MODEL_ALIASES[modelName.toLowerCase()];
  if (alias) {
    return alias;
  }
  // 尝试模糊匹配
  const lowerModelName = modelName.toLowerCase();
  for (const [alias, canonical] of Object.entries(MODEL_ALIASES)) {
    if (lowerModelName.includes(alias)) {
      return canonical;
    }
  }
  return modelName;
}

/**
 * 获取模型定价配置
 */
export function getModelPricing(
  modelName: string,
  isFastMode?: boolean
): ModelPricing {
  const canonicalName = getCanonicalModelName(modelName);
  let pricing = MODEL_PRICING[canonicalName];

  if (!pricing) {
    hasUnknownModelCost = true;
    return DEFAULT_UNKNOWN_MODEL_COST;
  }

  // 如果是快速模式且有快速模式定价配置，使用快速模式定价
  if (isFastMode && pricing.fastModePricing) {
    return pricing.fastModePricing;
  }

  return pricing;
}

/**
 * 检查是否有未知模型成本
 */
export function hasUnknownModel(): boolean {
  return hasUnknownModelCost;
}

/**
 * 重置未知模型标志
 */
export function resetUnknownModelFlag(): void {
  hasUnknownModelCost = false;
}

/**
 * 计算模型使用成本
 */
export function calculateModelCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number = 0,
  cacheCreationTokens: number = 0,
  webSearchRequests: number = 0,
  isFastMode?: boolean
): number {
  const pricing = getModelPricing(modelName, isFastMode);

  let cost = 0;

  // 计算输入令牌成本
  cost += (inputTokens / 1_000_000) * pricing.inputPricePerMillion;

  // 计算输出令牌成本
  cost += (outputTokens / 1_000_000) * pricing.outputPricePerMillion;

  // 计算缓存读取令牌成本
  cost += (cacheReadTokens / 1_000_000) * pricing.cacheReadPricePerMillion;

  // 计算缓存创建令牌成本
  cost +=
    (cacheCreationTokens / 1_000_000) * pricing.cacheCreationPricePerMillion;

  // 计算网络搜索请求成本
  cost += webSearchRequests * pricing.webSearchPricePerRequest;

  return cost;
}

/**
 * 从原始令牌计数计算成本
 */
export function calculateCostFromTokens(
  modelName: string,
  tokens: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    webSearchRequests?: number;
  },
  isFastMode?: boolean
): number {
  return calculateModelCost(
    modelName,
    tokens.inputTokens,
    tokens.outputTokens,
    tokens.cacheReadTokens || 0,
    tokens.cacheCreationTokens || 0,
    tokens.webSearchRequests || 0,
    isFastMode
  );
}

/**
 * 格式化价格
 */
export function formatPrice(price: number): string {
  if (Number.isInteger(price)) {
    return `$${price}`;
  }
  return `$${price.toFixed(2)}`;
}

/**
 * 格式化模型定价信息
 */
export function formatModelPricing(pricing: ModelPricing): string {
  return `${formatPrice(pricing.inputPricePerMillion)}/${formatPrice(pricing.outputPricePerMillion)} 每百万令牌`;
}

/**
 * 获取模型定价字符串
 */
export function getModelPricingString(
  modelName: string,
  isFastMode?: boolean
): string {
  const pricing = getModelPricing(modelName, isFastMode);
  return formatModelPricing(pricing);
}

/**
 * 格式化成本为字符串
 */
export function formatCost(cost: number, maxDecimalPlaces: number = 4): string {
  return `$${cost > 0.5 ? Math.round(cost * 100) / 100 : cost.toFixed(maxDecimalPlaces)}`;
}
