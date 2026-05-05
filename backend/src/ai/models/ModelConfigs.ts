/**
 * 模型配置定义
 * 参考CC源码: cc_code/backend/utils/model/configs.ts
 */

/**
 * API提供商类型
 */
export type APIProvider = 
  | 'firstParty'
  | 'bedrock'
  | 'vertex'
  | 'azure'
  | 'openai'
  | 'deepseek';

/**
 * 模型配置
 */
export interface ModelConfig {
  firstParty: string;
  bedrock: string;
  vertex: string;
  azure: string;
  openai: string;
  deepseek: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  pricing?: {
    inputPer1K: number;
    outputPer1K: number;
  };
}

/**
 * 模型键类型
 */
export type ModelKey = 
  | 'opus46'
  | 'opus45'
  | 'opus41'
  | 'opus40'
  | 'sonnet46'
  | 'sonnet45'
  | 'sonnet41'
  | 'sonnet40'
  | 'sonnet35'
  | 'haiku45'
  | 'haiku40';

/**
 * 所有模型配置
 */
export const ALL_MODEL_CONFIGS: Record<ModelKey, ModelConfig> = {
  opus46: {
    firstParty: 'claude-opus-4-6-20250219',
    bedrock: 'anthropic.claude-opus-4-6-20250219-v1:0',
    vertex: 'claude-opus-4-6-20250219',
    azure: 'claude-opus-4-6-20250219',
    openai: '',
    deepseek: '',
    displayName: 'Claude Opus 4.6',
    contextWindow: 200000,
    maxOutputTokens: 16384,
    pricing: {
      inputPer1K: 0.015,
      outputPer1K: 0.075,
    },
  },
  opus45: {
    firstParty: 'claude-opus-4-5-20250219',
    bedrock: 'anthropic.claude-opus-4-5-20250219-v1:0',
    vertex: 'claude-opus-4-5-20250219',
    azure: 'claude-opus-4-5-20250219',
    openai: '',
    deepseek: '',
    displayName: 'Claude Opus 4.5',
    contextWindow: 200000,
    maxOutputTokens: 16384,
    pricing: {
      inputPer1K: 0.015,
      outputPer1K: 0.075,
    },
  },
  opus41: {
    firstParty: 'claude-opus-4-1-20250219',
    bedrock: 'anthropic.claude-opus-4-1-20250219-v1:0',
    vertex: 'claude-opus-4-1-20250219',
    azure: 'claude-opus-4-1-20250219',
    openai: '',
    deepseek: '',
    displayName: 'Claude Opus 4.1',
    contextWindow: 200000,
    maxOutputTokens: 16384,
    pricing: {
      inputPer1K: 0.015,
      outputPer1K: 0.075,
    },
  },
  opus40: {
    firstParty: 'claude-opus-4-0-20250219',
    bedrock: 'anthropic.claude-opus-4-0-20250219-v1:0',
    vertex: 'claude-opus-4-0-20250219',
    azure: 'claude-opus-4-0-20250219',
    openai: '',
    deepseek: '',
    displayName: 'Claude Opus 4.0',
    contextWindow: 200000,
    maxOutputTokens: 16384,
    pricing: {
      inputPer1K: 0.015,
      outputPer1K: 0.075,
    },
  },
  sonnet46: {
    firstParty: 'claude-sonnet-4-6-20250219',
    bedrock: 'anthropic.claude-sonnet-4-6-20250219-v1:0',
    vertex: 'claude-sonnet-4-6-20250219',
    azure: 'claude-sonnet-4-6-20250219',
    openai: '',
    deepseek: '',
    displayName: 'Claude Sonnet 4.6',
    contextWindow: 200000,
    maxOutputTokens: 16384,
    pricing: {
      inputPer1K: 0.003,
      outputPer1K: 0.015,
    },
  },
  sonnet45: {
    firstParty: 'claude-sonnet-4-5-20250219',
    bedrock: 'anthropic.claude-sonnet-4-5-20250219-v1:0',
    vertex: 'claude-sonnet-4-5-20250219',
    azure: 'claude-sonnet-4-5-20250219',
    openai: '',
    deepseek: '',
    displayName: 'Claude Sonnet 4.5',
    contextWindow: 200000,
    maxOutputTokens: 16384,
    pricing: {
      inputPer1K: 0.003,
      outputPer1K: 0.015,
    },
  },
  sonnet41: {
    firstParty: 'claude-sonnet-4-1-20250219',
    bedrock: 'anthropic.claude-sonnet-4-1-20250219-v1:0',
    vertex: 'claude-sonnet-4-1-20250219',
    azure: 'claude-sonnet-4-1-20250219',
    openai: '',
    deepseek: '',
    displayName: 'Claude Sonnet 4.1',
    contextWindow: 200000,
    maxOutputTokens: 16384,
    pricing: {
      inputPer1K: 0.003,
      outputPer1K: 0.015,
    },
  },
  sonnet40: {
    firstParty: 'claude-sonnet-4-0-20250219',
    bedrock: 'anthropic.claude-sonnet-4-0-20250219-v1:0',
    vertex: 'claude-sonnet-4-0-20250219',
    azure: 'claude-sonnet-4-0-20250219',
    openai: '',
    deepseek: '',
    displayName: 'Claude Sonnet 4.0',
    contextWindow: 200000,
    maxOutputTokens: 16384,
    pricing: {
      inputPer1K: 0.003,
      outputPer1K: 0.015,
    },
  },
  sonnet35: {
    firstParty: 'claude-3-5-sonnet-20241022',
    bedrock: 'anthropic.claude-3-5-sonnet-20241022-v1:0',
    vertex: 'claude-3-5-sonnet-20241022',
    azure: 'claude-3-5-sonnet-20241022',
    openai: '',
    deepseek: '',
    displayName: 'Claude 3.5 Sonnet',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    pricing: {
      inputPer1K: 0.003,
      outputPer1K: 0.015,
    },
  },
  haiku45: {
    firstParty: 'claude-3-5-haiku-20241022',
    bedrock: 'anthropic.claude-3-5-haiku-20241022-v1:0',
    vertex: 'claude-3-5-haiku-20241022',
    azure: 'claude-3-5-haiku-20241022',
    openai: '',
    deepseek: '',
    displayName: 'Claude 3.5 Haiku',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    pricing: {
      inputPer1K: 0.001,
      outputPer1K: 0.005,
    },
  },
  haiku40: {
    firstParty: 'claude-3-haiku-20240307',
    bedrock: 'anthropic.claude-3-haiku-20240307-v1:0',
    vertex: 'claude-3-haiku-20240307',
    azure: 'claude-3-haiku-20240307',
    openai: '',
    deepseek: '',
    displayName: 'Claude 3 Haiku',
    contextWindow: 200000,
    maxOutputTokens: 4096,
    pricing: {
      inputPer1K: 0.00025,
      outputPer1K: 0.00125,
    },
  },
};

/**
 * 规范化模型ID到键的映射
 */
export const CANONICAL_ID_TO_KEY: Record<string, ModelKey> = {
  'claude-opus-4-6-20250219': 'opus46',
  'claude-opus-4-5-20250219': 'opus45',
  'claude-opus-4-1-20250219': 'opus41',
  'claude-opus-4-0-20250219': 'opus40',
  'claude-sonnet-4-6-20250219': 'sonnet46',
  'claude-sonnet-4-5-20250219': 'sonnet45',
  'claude-sonnet-4-1-20250219': 'sonnet41',
  'claude-sonnet-4-0-20250219': 'sonnet40',
  'claude-3-5-sonnet-20241022': 'sonnet35',
  'claude-3-5-haiku-20241022': 'haiku45',
  'claude-3-haiku-20240307': 'haiku40',
};

/**
 * 获取模型配置
 * @param modelKey 模型键
 * @returns 模型配置
 */
export function getModelConfig(modelKey: ModelKey): ModelConfig {
  return ALL_MODEL_CONFIGS[modelKey];
}

/**
 * 根据模型名称获取模型键
 * @param modelName 模型名称
 * @returns 模型键或null
 */
export function getModelKeyByName(modelName: string): ModelKey | null {
  for (const [key, config] of Object.entries(ALL_MODEL_CONFIGS)) {
    if (
      config.firstParty === modelName ||
      config.bedrock === modelName ||
      config.vertex === modelName ||
      config.azure === modelName
    ) {
      return key as ModelKey;
    }
  }
  return null;
}

/**
 * 获取提供商特定的模型名称
 * @param modelKey 模型键
 * @param provider API提供商
 * @returns 模型名称
 */
export function getModelNameForProvider(
  modelKey: ModelKey,
  provider: APIProvider
): string {
  const config = ALL_MODEL_CONFIGS[modelKey];
  return config[provider];
}
