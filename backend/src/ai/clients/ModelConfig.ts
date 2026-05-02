/**
 * 模型配置管理器
 *
 * 参考CC源码的模型选择优先级设计
 *
 * 优先级顺序:
 * 1. 运行时模型覆盖（代码级别设置）- 最高优先级
 * 2. 环境变量 (DEEPSEEK_MODEL)
 * 3. 配置文件设置
 * 4. 内置默认值
 */

export interface ModelConfig {
  model: string;
  apiKey: string;
  baseUrl: string;
  maxTokens: number;
  temperature: number;
}

export interface ModelMetadata {
  name: string;
  context: number;
  capabilities: string[];
  description: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  model?: ModelMetadata;
}

const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.7;

// DeepSeek 模型定义
export const DEEPSEEK_MODELS: Record<string, ModelMetadata> = {
  'deepseek-chat': {
    name: 'DeepSeek Chat',
    context: 128000,
    capabilities: ['chat', 'tools', 'general'],
    description: '通用聊天模型，适合日常对话和工具调用',
  },
  'deepseek-coder': {
    name: 'DeepSeek Coder',
    context: 128000,
    capabilities: ['code', 'tools', 'programming'],
    description: '代码专用模型，适合编程和代码分析',
  },
  'deepseek-reasoner': {
    name: 'DeepSeek Reasoner',
    context: 128000,
    capabilities: ['reasoning', 'analysis', 'logic'],
    description: '推理模型，适合复杂问题分析和逻辑推理',
  },
};

let runtimeModelOverride: string | undefined;
let runtimeApiKeyOverride: string | undefined;
let runtimeBaseUrlOverride: string | undefined;

export function getModelOverride(): string | undefined {
  return runtimeModelOverride;
}

export function setModelOverride(model: string | undefined): void {
  runtimeModelOverride = model;
}

export function getApiKeyOverride(): string | undefined {
  return runtimeApiKeyOverride;
}

export function setApiKeyOverride(apiKey: string | undefined): void {
  runtimeApiKeyOverride = apiKey;
}

export function getBaseUrlOverride(): string | undefined {
  return runtimeBaseUrlOverride;
}

export function setBaseUrlOverride(baseUrl: string | undefined): void {
  runtimeBaseUrlOverride = baseUrl;
}

export function getDefaultModel(): string {
  return process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
}

export function getDefaultApiKey(): string {
  return process.env.DEEPSEEK_API_KEY || '';
}

export function getDefaultBaseUrl(): string {
  return process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL;
}

export function resolveModel(): string {
  return runtimeModelOverride || getDefaultModel();
}

export function resolveApiKey(): string {
  return runtimeApiKeyOverride || getDefaultApiKey();
}

export function resolveBaseUrl(): string {
  return runtimeBaseUrlOverride || getDefaultBaseUrl();
}

export function getModelConfig(): ModelConfig {
  return {
    model: resolveModel(),
    apiKey: resolveApiKey(),
    baseUrl: resolveBaseUrl(),
    maxTokens: DEFAULT_MAX_TOKENS,
    temperature: DEFAULT_TEMPERATURE,
  };
}

export function getAllAvailableModels(): string[] {
  return Object.keys(DEEPSEEK_MODELS);
}

export function isValidModel(model: string): boolean {
  return getAllAvailableModels().includes(model);
}

export function getModelMetadata(model: string): ModelMetadata | undefined {
  return DEEPSEEK_MODELS[model];
}

export function validateModel(model: string): ValidationResult {
  if (!isValidModel(model)) {
    return {
      valid: false,
      error: `Model "${model}" is not supported. Available models: ${getAllAvailableModels().join(', ')}`,
    };
  }

  const apiKey = resolveApiKey();
  if (!apiKey) {
    return {
      valid: false,
      error: 'DEEPSEEK_API_KEY environment variable is not set',
    };
  }

  const metadata = getModelMetadata(model);
  if (!metadata) {
    return {
      valid: false,
      error: `No metadata found for model "${model}"`,
    };
  }

  return {
    valid: true,
    model: metadata,
  };
}

export function getModelOptions(): Array<{
  value: string;
  label: string;
  description: string;
  capabilities: string[];
}> {
  return Object.entries(DEEPSEEK_MODELS).map(([key, metadata]) => ({
    value: key,
    label: metadata.name,
    description: metadata.description,
    capabilities: metadata.capabilities,
  }));
}

export function getModelContextSize(model: string): number {
  const metadata = getModelMetadata(model);
  return metadata ? metadata.context : 128000;
}

export function modelSupportsCapability(
  model: string,
  capability: string
): boolean {
  const metadata = getModelMetadata(model);
  return metadata ? metadata.capabilities.includes(capability) : false;
}

export function getRecommendedModel(): string {
  return DEFAULT_MODEL;
}

export function clearOverrides(): void {
  runtimeModelOverride = undefined;
  runtimeApiKeyOverride = undefined;
  runtimeBaseUrlOverride = undefined;
}
