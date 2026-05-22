/**
 * 模型配置定义
 */

import { ModelCapability } from './types.js';

/**
 * API提供商类型
 */
export type APIProvider =
  | 'firstParty'
  | 'bedrock'
  | 'vertex'
  | 'azure'
  | 'openai'
  | 'deepseek'
  | 'google'
  | 'ollama'
  | 'grok'
  | 'moonshot';

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
  google: string;
  grok: string;
  moonshot: string;
  ollama: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities?: ModelCapability[];
  pricing?: {
    inputPer1M: number;
    outputPer1M: number;
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
  | 'haiku35'
  | 'haiku30'
  | 'deepseekChat'
  | 'deepseekReasoner'
  | 'gpt4o'
  | 'gpt4oMini'
  | 'gpt4Turbo'
  | 'gpt4'
  | 'o1'
  | 'o1Mini'
  | 'o3Mini'
  | 'gpt41Nano'
  | 'gpt35Turbo'
  | 'gemini25Pro'
  | 'gemini25Flash'
  | 'gemini20Flash'
  | 'gemini20FlashLite'
  | 'gemini15Pro'
  | 'gemini15Flash'
  | 'grok4'
  | 'grok4Mini'
  | 'grok3'
  | 'grok3Mini'
  | 'moonshot8k'
  | 'moonshot32k'
  | 'moonshot128k'
  | 'ollamaLlama3'
  | 'ollamaMistral'
  | 'amazonNovaPro'
  | 'amazonNovaLite';

/**
 * 所有模型配置
 */
export const ALL_MODEL_CONFIGS: Record<ModelKey, ModelConfig> = {
  opus46: {
    firstParty: 'claude-opus-4-6',
    bedrock: 'us.anthropic.claude-opus-4-6-v1',
    vertex: 'claude-opus-4-6',
    azure: 'claude-opus-4-6',
    openai: '',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'Claude Opus 4.6',
    contextWindow: 200000,
    maxOutputTokens: 16384,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.VISION,
      ModelCapability.THINKING,
      ModelCapability.EXTENDED_THINKING,
      ModelCapability.TOOL_USE,
      ModelCapability.COMPUTER_USE,
      ModelCapability.CONTEXT_CACHING,
      ModelCapability.STRUCTURED_OUTPUT,
      ModelCapability.PARALLEL_TOOL_CALLS,
      ModelCapability.IMAGE_INPUT,
      ModelCapability.PDF_INPUT,
    ],
    pricing: {
      inputPer1M: 15,
      outputPer1M: 75,
    },
  },
  opus45: {
    firstParty: 'claude-opus-4-5-20251101',
    bedrock: 'us.anthropic.claude-opus-4-5-20251101-v1:0',
    vertex: 'claude-opus-4-5@20251101',
    azure: 'claude-opus-4-5-20251101',
    openai: '',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'Claude Opus 4.5',
    contextWindow: 200000,
    maxOutputTokens: 16384,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.VISION,
      ModelCapability.THINKING,
      ModelCapability.EXTENDED_THINKING,
      ModelCapability.TOOL_USE,
      ModelCapability.COMPUTER_USE,
      ModelCapability.CONTEXT_CACHING,
      ModelCapability.STRUCTURED_OUTPUT,
      ModelCapability.PARALLEL_TOOL_CALLS,
      ModelCapability.IMAGE_INPUT,
      ModelCapability.PDF_INPUT,
    ],
    pricing: {
      inputPer1M: 15,
      outputPer1M: 75,
    },
  },
  opus41: {
    firstParty: 'claude-opus-4-1-20250805',
    bedrock: 'us.anthropic.claude-opus-4-1-20250805-v1:0',
    vertex: 'claude-opus-4-1@20250805',
    azure: 'claude-opus-4-1-20250805',
    openai: '',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'Claude Opus 4.1',
    contextWindow: 200000,
    maxOutputTokens: 16384,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.VISION,
      ModelCapability.THINKING,
      ModelCapability.EXTENDED_THINKING,
      ModelCapability.TOOL_USE,
      ModelCapability.COMPUTER_USE,
      ModelCapability.CONTEXT_CACHING,
      ModelCapability.STRUCTURED_OUTPUT,
      ModelCapability.PARALLEL_TOOL_CALLS,
      ModelCapability.IMAGE_INPUT,
      ModelCapability.PDF_INPUT,
    ],
    pricing: {
      inputPer1M: 15,
      outputPer1M: 75,
    },
  },
  opus40: {
    firstParty: 'claude-opus-4-20250514',
    bedrock: 'us.anthropic.claude-opus-4-20250514-v1:0',
    vertex: 'claude-opus-4@20250514',
    azure: 'claude-opus-4-20250514',
    openai: '',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'Claude Opus 4',
    contextWindow: 200000,
    maxOutputTokens: 16384,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.VISION,
      ModelCapability.THINKING,
      ModelCapability.EXTENDED_THINKING,
      ModelCapability.TOOL_USE,
      ModelCapability.COMPUTER_USE,
      ModelCapability.CONTEXT_CACHING,
      ModelCapability.STRUCTURED_OUTPUT,
      ModelCapability.PARALLEL_TOOL_CALLS,
      ModelCapability.IMAGE_INPUT,
      ModelCapability.PDF_INPUT,
    ],
    pricing: {
      inputPer1M: 15,
      outputPer1M: 75,
    },
  },
  sonnet46: {
    firstParty: 'claude-sonnet-4-6',
    bedrock: 'us.anthropic.claude-sonnet-4-6',
    vertex: 'claude-sonnet-4-6',
    azure: 'claude-sonnet-4-6',
    openai: '',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'Claude Sonnet 4.6',
    contextWindow: 200000,
    maxOutputTokens: 16384,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.VISION,
      ModelCapability.THINKING,
      ModelCapability.EXTENDED_THINKING,
      ModelCapability.TOOL_USE,
      ModelCapability.COMPUTER_USE,
      ModelCapability.CONTEXT_CACHING,
      ModelCapability.STRUCTURED_OUTPUT,
      ModelCapability.PARALLEL_TOOL_CALLS,
      ModelCapability.IMAGE_INPUT,
      ModelCapability.PDF_INPUT,
    ],
    pricing: {
      inputPer1M: 3,
      outputPer1M: 15,
    },
  },
  sonnet45: {
    firstParty: 'claude-sonnet-4-5-20250929',
    bedrock: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    vertex: 'claude-sonnet-4-5@20250929',
    azure: 'claude-sonnet-4-5-20250929',
    openai: '',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'Claude Sonnet 4.5',
    contextWindow: 200000,
    maxOutputTokens: 16384,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.VISION,
      ModelCapability.THINKING,
      ModelCapability.TOOL_USE,
      ModelCapability.CONTEXT_CACHING,
      ModelCapability.STRUCTURED_OUTPUT,
      ModelCapability.PARALLEL_TOOL_CALLS,
      ModelCapability.IMAGE_INPUT,
      ModelCapability.PDF_INPUT,
    ],
    pricing: {
      inputPer1M: 3,
      outputPer1M: 15,
    },
  },
  sonnet41: {
    firstParty: 'claude-sonnet-4-1',
    bedrock: 'us.anthropic.claude-sonnet-4-1',
    vertex: 'claude-sonnet-4-1',
    azure: 'claude-sonnet-4-1',
    openai: '',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'Claude Sonnet 4.1',
    contextWindow: 200000,
    maxOutputTokens: 16384,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.VISION,
      ModelCapability.THINKING,
      ModelCapability.TOOL_USE,
      ModelCapability.CONTEXT_CACHING,
      ModelCapability.STRUCTURED_OUTPUT,
      ModelCapability.PARALLEL_TOOL_CALLS,
      ModelCapability.IMAGE_INPUT,
      ModelCapability.PDF_INPUT,
    ],
    pricing: {
      inputPer1M: 3,
      outputPer1M: 15,
    },
  },
  sonnet40: {
    firstParty: 'claude-sonnet-4-20250514',
    bedrock: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
    vertex: 'claude-sonnet-4@20250514',
    azure: 'claude-sonnet-4-20250514',
    openai: '',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'Claude Sonnet 4',
    contextWindow: 200000,
    maxOutputTokens: 16384,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.VISION,
      ModelCapability.THINKING,
      ModelCapability.TOOL_USE,
      ModelCapability.CONTEXT_CACHING,
      ModelCapability.STRUCTURED_OUTPUT,
      ModelCapability.PARALLEL_TOOL_CALLS,
      ModelCapability.IMAGE_INPUT,
      ModelCapability.PDF_INPUT,
    ],
    pricing: {
      inputPer1M: 3,
      outputPer1M: 15,
    },
  },
  sonnet35: {
    firstParty: 'claude-3-5-sonnet-20241022',
    bedrock: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    vertex: 'claude-3-5-sonnet-v2@20241022',
    azure: 'claude-3-5-sonnet-20241022',
    openai: '',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'Claude 3.5 Sonnet',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.VISION,
      ModelCapability.TOOL_USE,
      ModelCapability.CONTEXT_CACHING,
      ModelCapability.STRUCTURED_OUTPUT,
      ModelCapability.PARALLEL_TOOL_CALLS,
      ModelCapability.IMAGE_INPUT,
      ModelCapability.PDF_INPUT,
    ],
    pricing: {
      inputPer1M: 3,
      outputPer1M: 15,
    },
  },
  haiku45: {
    firstParty: 'claude-haiku-4-5-20251001',
    bedrock: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    vertex: 'claude-haiku-4-5@20251001',
    azure: 'claude-haiku-4-5-20251001',
    openai: '',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'Claude Haiku 4.5',
    contextWindow: 200000,
    maxOutputTokens: 16384,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.VISION,
      ModelCapability.THINKING,
      ModelCapability.TOOL_USE,
      ModelCapability.CONTEXT_CACHING,
      ModelCapability.STRUCTURED_OUTPUT,
      ModelCapability.PARALLEL_TOOL_CALLS,
      ModelCapability.IMAGE_INPUT,
      ModelCapability.PDF_INPUT,
    ],
    pricing: {
      inputPer1M: 1,
      outputPer1M: 5,
    },
  },
  haiku35: {
    firstParty: 'claude-3-5-haiku-20241022',
    bedrock: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
    vertex: 'claude-3-5-haiku@20241022',
    azure: 'claude-3-5-haiku-20241022',
    openai: '',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'Claude 3.5 Haiku',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.VISION,
      ModelCapability.TOOL_USE,
      ModelCapability.CONTEXT_CACHING,
      ModelCapability.STRUCTURED_OUTPUT,
      ModelCapability.PARALLEL_TOOL_CALLS,
      ModelCapability.IMAGE_INPUT,
      ModelCapability.PDF_INPUT,
    ],
    pricing: {
      inputPer1M: 0.8,
      outputPer1M: 4,
    },
  },
  haiku30: {
    firstParty: 'claude-3-haiku-20240307',
    bedrock: 'anthropic.claude-3-haiku-20240307-v1:0',
    vertex: 'claude-3-haiku@20240307',
    azure: 'claude-3-haiku-20240307',
    openai: '',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'Claude 3 Haiku',
    contextWindow: 200000,
    maxOutputTokens: 4096,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.VISION,
      ModelCapability.TOOL_USE,
      ModelCapability.STRUCTURED_OUTPUT,
      ModelCapability.IMAGE_INPUT,
    ],
    pricing: {
      inputPer1M: 0.25,
      outputPer1M: 1.25,
    },
  },
  deepseekChat: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: '',
    deepseek: 'deepseek-chat',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'DeepSeek Chat',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.THINKING,
      ModelCapability.CONTEXT_CACHING,
      ModelCapability.STRUCTURED_OUTPUT,
      ModelCapability.PARALLEL_TOOL_CALLS,
    ],
    pricing: {
      inputPer1M: 0.5,
      outputPer1M: 2,
    },
  },
  deepseekReasoner: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: '',
    deepseek: 'deepseek-reasoner',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'DeepSeek Reasoner',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.THINKING,
      ModelCapability.TOOL_USE,
    ],
    pricing: {
      inputPer1M: 0.55,
      outputPer1M: 2.19,
    },
  },
  gpt4o: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: 'gpt-4o',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'GPT-4o',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.VISION,
      ModelCapability.TOOL_USE,
      ModelCapability.STRUCTURED_OUTPUT,
      ModelCapability.PARALLEL_TOOL_CALLS,
      ModelCapability.IMAGE_INPUT,
    ],
    pricing: {
      inputPer1M: 2.5,
      outputPer1M: 10,
    },
  },
  gpt4oMini: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: 'gpt-4o-mini',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'GPT-4o Mini',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.VISION,
      ModelCapability.TOOL_USE,
      ModelCapability.STRUCTURED_OUTPUT,
      ModelCapability.PARALLEL_TOOL_CALLS,
      ModelCapability.IMAGE_INPUT,
    ],
    pricing: {
      inputPer1M: 0.15,
      outputPer1M: 0.6,
    },
  },
  gpt4Turbo: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: 'gpt-4-turbo',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'GPT-4 Turbo',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.VISION,
      ModelCapability.TOOL_USE,
      ModelCapability.IMAGE_INPUT,
    ],
    pricing: {
      inputPer1M: 10,
      outputPer1M: 30,
    },
  },
  gpt4: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: 'gpt-4',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'GPT-4',
    contextWindow: 8192,
    maxOutputTokens: 4096,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.TOOL_USE,
    ],
    pricing: {
      inputPer1M: 30,
      outputPer1M: 60,
    },
  },
  o1: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: 'o1',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'o1',
    contextWindow: 200000,
    maxOutputTokens: 100000,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.VISION,
      ModelCapability.THINKING,
      ModelCapability.TOOL_USE,
    ],
    pricing: {
      inputPer1M: 15,
      outputPer1M: 60,
    },
  },
  o1Mini: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: 'o1-mini',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'o1 Mini',
    contextWindow: 128000,
    maxOutputTokens: 65536,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.THINKING,
      ModelCapability.TOOL_USE,
    ],
    pricing: {
      inputPer1M: 1.1,
      outputPer1M: 4.4,
    },
  },
  o3Mini: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: 'o3-mini',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'o3 Mini',
    contextWindow: 200000,
    maxOutputTokens: 100000,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.THINKING,
      ModelCapability.TOOL_USE,
    ],
    pricing: {
      inputPer1M: 1.1,
      outputPer1M: 4.4,
    },
  },
  gpt41Nano: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: 'gpt-4.1-nano',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'GPT-4.1 Nano',
    contextWindow: 1048576,
    maxOutputTokens: 32768,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.TOOL_USE,
      ModelCapability.STRUCTURED_OUTPUT,
      ModelCapability.PARALLEL_TOOL_CALLS,
    ],
    pricing: {
      inputPer1M: 0.1,
      outputPer1M: 0.4,
    },
  },
  gpt35Turbo: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: 'gpt-3.5-turbo',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'GPT-3.5 Turbo',
    contextWindow: 16385,
    maxOutputTokens: 4096,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.TOOL_USE,
    ],
    pricing: {
      inputPer1M: 1.5,
      outputPer1M: 2,
    },
  },
  gemini25Pro: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: '',
    deepseek: '',
    google: 'gemini-2.5-pro',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'Gemini 2.5 Pro',
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.VISION,
      ModelCapability.TOOL_USE,
      ModelCapability.STRUCTURED_OUTPUT,
      ModelCapability.CODE_EXECUTION,
      ModelCapability.IMAGE_INPUT,
      ModelCapability.PDF_INPUT,
    ],
    pricing: {
      inputPer1M: 1.25,
      outputPer1M: 10,
    },
  },
  gemini25Flash: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: '',
    deepseek: '',
    google: 'gemini-2.5-flash',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'Gemini 2.5 Flash',
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.VISION,
      ModelCapability.TOOL_USE,
      ModelCapability.STRUCTURED_OUTPUT,
      ModelCapability.IMAGE_INPUT,
    ],
    pricing: {
      inputPer1M: 0.15,
      outputPer1M: 0.6,
    },
  },
  gemini20Flash: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: '',
    deepseek: '',
    google: 'gemini-2.0-flash',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'Gemini 2.0 Flash',
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.VISION,
      ModelCapability.TOOL_USE,
      ModelCapability.STRUCTURED_OUTPUT,
      ModelCapability.IMAGE_INPUT,
    ],
    pricing: {
      inputPer1M: 0.1,
      outputPer1M: 0.4,
    },
  },
  gemini20FlashLite: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: '',
    deepseek: '',
    google: 'gemini-2.0-flash-lite',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'Gemini 2.0 Flash Lite',
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.TOOL_USE,
    ],
    pricing: {
      inputPer1M: 0.075,
      outputPer1M: 0.3,
    },
  },
  gemini15Pro: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: '',
    deepseek: '',
    google: 'gemini-1.5-pro',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'Gemini 1.5 Pro',
    contextWindow: 2097152,
    maxOutputTokens: 8192,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.VISION,
      ModelCapability.TOOL_USE,
      ModelCapability.CODE_EXECUTION,
      ModelCapability.IMAGE_INPUT,
      ModelCapability.PDF_INPUT,
      ModelCapability.CONTEXT_CACHING,
    ],
    pricing: {
      inputPer1M: 1.25,
      outputPer1M: 5,
    },
  },
  gemini15Flash: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: '',
    deepseek: '',
    google: 'gemini-1.5-flash',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'Gemini 1.5 Flash',
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.VISION,
      ModelCapability.TOOL_USE,
      ModelCapability.IMAGE_INPUT,
      ModelCapability.CONTEXT_CACHING,
    ],
    pricing: {
      inputPer1M: 0.075,
      outputPer1M: 0.3,
    },
  },
  grok4: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: '',
    deepseek: '',
    google: '',
    grok: 'grok-4',
    moonshot: '',
    ollama: '',
    displayName: 'Grok 4',
    contextWindow: 131072,
    maxOutputTokens: 8192,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.TOOL_USE,
    ],
  },
  grok4Mini: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: '',
    deepseek: '',
    google: '',
    grok: 'grok-4-mini',
    moonshot: '',
    ollama: '',
    displayName: 'Grok 4 Mini',
    contextWindow: 131072,
    maxOutputTokens: 8192,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.TOOL_USE,
    ],
  },
  grok3: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: '',
    deepseek: '',
    google: '',
    grok: 'grok-3',
    moonshot: '',
    ollama: '',
    displayName: 'Grok 3',
    contextWindow: 131072,
    maxOutputTokens: 8192,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.TOOL_USE,
    ],
  },
  grok3Mini: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: '',
    deepseek: '',
    google: '',
    grok: 'grok-3-mini',
    moonshot: '',
    ollama: '',
    displayName: 'Grok 3 Mini',
    contextWindow: 131072,
    maxOutputTokens: 8192,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.TOOL_USE,
    ],
  },
  moonshot8k: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: '',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: 'moonshot-v1-8k',
    ollama: '',
    displayName: 'Moonshot v1 (8K)',
    contextWindow: 8192,
    maxOutputTokens: 4096,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.TOOL_USE,
    ],
  },
  moonshot32k: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: '',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: 'moonshot-v1-32k',
    ollama: '',
    displayName: 'Moonshot v1 (32K)',
    contextWindow: 32768,
    maxOutputTokens: 4096,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.TOOL_USE,
    ],
  },
  moonshot128k: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: '',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: 'moonshot-v1-128k',
    ollama: '',
    displayName: 'Moonshot v1 (128K)',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.TOOL_USE,
    ],
  },
  ollamaLlama3: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: '',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: 'llama3',
    displayName: 'Llama 3',
    contextWindow: 8192,
    maxOutputTokens: 4096,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.TOOL_USE,
    ],
  },
  ollamaMistral: {
    firstParty: '',
    bedrock: '',
    vertex: '',
    azure: '',
    openai: '',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: 'mistral',
    displayName: 'Mistral',
    contextWindow: 8192,
    maxOutputTokens: 4096,
    capabilities: [ModelCapability.STREAMING],
  },
  amazonNovaPro: {
    firstParty: '',
    bedrock: 'amazon.nova-pro-v1:0',
    vertex: '',
    azure: '',
    openai: '',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'Amazon Nova Pro',
    contextWindow: 300000,
    maxOutputTokens: 5120,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.TOOL_USE,
    ],
  },
  amazonNovaLite: {
    firstParty: '',
    bedrock: 'amazon.nova-lite-v1:0',
    vertex: '',
    azure: '',
    openai: '',
    deepseek: '',
    google: '',
    grok: '',
    moonshot: '',
    ollama: '',
    displayName: 'Amazon Nova Lite',
    contextWindow: 300000,
    maxOutputTokens: 5120,
    capabilities: [
      ModelCapability.STREAMING,
      ModelCapability.FUNCTION_CALLING,
      ModelCapability.TOOL_USE,
    ],
  },
};

/**
 * 规范化模型ID到键的映射
 */
export const CANONICAL_ID_TO_KEY: Record<string, ModelKey> = {
  'claude-opus-4-6': 'opus46',
  'claude-opus-4-5-20251101': 'opus45',
  'claude-opus-4-1-20250805': 'opus41',
  'claude-opus-4-20250514': 'opus40',
  'claude-sonnet-4-6': 'sonnet46',
  'claude-sonnet-4-5-20250929': 'sonnet45',
  'claude-sonnet-4-1': 'sonnet41',
  'claude-sonnet-4-20250514': 'sonnet40',
  'claude-3-5-sonnet-20241022': 'sonnet35',
  'claude-haiku-4-5-20251001': 'haiku45',
  'claude-3-5-haiku-20241022': 'haiku35',
  'claude-3-haiku-20240307': 'haiku30',
  'deepseek-chat': 'deepseekChat',
  'deepseek-reasoner': 'deepseekReasoner',
  'gpt-4o': 'gpt4o',
  'gpt-4o-mini': 'gpt4oMini',
  'gpt-4-turbo': 'gpt4Turbo',
  'gpt-4': 'gpt4',
  o1: 'o1',
  'o1-mini': 'o1Mini',
  'o3-mini': 'o3Mini',
  'gpt-4.1-nano': 'gpt41Nano',
  'gpt-3.5-turbo': 'gpt35Turbo',
  'gemini-2.5-pro': 'gemini25Pro',
  'gemini-2.5-flash': 'gemini25Flash',
  'gemini-2.0-flash': 'gemini20Flash',
  'gemini-2.0-flash-lite': 'gemini20FlashLite',
  'gemini-1.5-pro': 'gemini15Pro',
  'gemini-1.5-flash': 'gemini15Flash',
  'grok-4': 'grok4',
  'grok-4-mini': 'grok4Mini',
  'grok-3': 'grok3',
  'grok-3-mini': 'grok3Mini',
  'moonshot-v1-8k': 'moonshot8k',
  'moonshot-v1-32k': 'moonshot32k',
  'moonshot-v1-128k': 'moonshot128k',
  llama3: 'ollamaLlama3',
  mistral: 'ollamaMistral',
  'amazon.nova-pro-v1:0': 'amazonNovaPro',
  'amazon.nova-lite-v1:0': 'amazonNovaLite',
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
      config.azure === modelName ||
      config.openai === modelName ||
      config.deepseek === modelName ||
      config.google === modelName ||
      config.grok === modelName ||
      config.moonshot === modelName ||
      config.ollama === modelName
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

/**
 * 根据规范模型ID获取模型配置
 * @param id 规范模型ID
 * @returns 模型配置或undefined
 */
export function getModelConfigById(id: string): ModelConfig | undefined {
  const key = CANONICAL_ID_TO_KEY[id];
  return key ? ALL_MODEL_CONFIGS[key] : undefined;
}

/**
 * 获取包含指定能力的模型列表
 * @param capability 模型能力
 * @returns 支持该能力的模型键列表
 */
export function getModelsWithCapability(
  capability: ModelCapability
): ModelKey[] {
  return (Object.entries(ALL_MODEL_CONFIGS) as [string, ModelConfig][])
    .filter(([_, config]) => config.capabilities?.includes(capability))
    .map(([key]) => key as ModelKey);
}

/**
 * 获取指定提供商支持的所有模型
 * @param provider API提供商
 * @returns 该提供商可用的模型键列表
 */
export function getModelsByProvider(provider: APIProvider): ModelKey[] {
  return (Object.entries(ALL_MODEL_CONFIGS) as [string, ModelConfig][])
    .filter(([_, config]) => config[provider] && config[provider] !== '')
    .map(([key]) => key as ModelKey);
}
