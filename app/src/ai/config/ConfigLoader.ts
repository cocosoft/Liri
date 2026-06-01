/**
 * YAML 配置加载器
 * 从 ~/.pyapp/ 目录加载用户维护的 YAML 配置文件
 */

import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { load } from 'js-yaml';
import { resolvePyappHome } from '@modules/config/paths';

/**
 * Provider 配置
 */
export interface ProviderConfig {
  api: string;
  baseUrl: string;
  apiKey?: string;
  models?: string[];
  headers?: Record<string, string>;
  modelPrefix?: string;
}

/**
 * providers.yaml 文件结构
 */
export interface ProvidersConfigFile {
  providers: Record<string, ProviderConfig>;
}

/**
 * 模型覆盖配置
 */
export interface ModelOverrideConfig {
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  baseModel?: string;
  capabilities?: string[];
  pricing?: {
    inputPer1M: number;
    outputPer1M: number;
    cacheReadPer1M?: number;
    cacheWritePer1M?: number;
  };
}

/**
 * models.yaml 文件结构
 */
export interface ModelsConfigFile {
  models: Record<string, ModelOverrideConfig>;
}

/**
 * 定价覆盖配置
 */
export interface PricingOverride {
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M?: number;
  cacheWritePer1M?: number;
}

/**
 * pricing.yaml 文件结构
 */
export interface PricingConfigFile {
  pricing: Record<string, PricingOverride>;
}

/**
 * 加载 providers.yaml
 */
export function loadProvidersConfig(): ProvidersConfigFile {
  const configPath = join(resolvePyappHome(), 'providers.yaml');
  if (!existsSync(configPath)) {
    return { providers: {} };
  }
  return load(readFileSync(configPath, 'utf-8')) as ProvidersConfigFile;
}

/**
 * 加载 models.yaml
 */
export function loadModelsConfig(): ModelsConfigFile {
  const configPath = join(resolvePyappHome(), 'models.yaml');
  if (!existsSync(configPath)) {
    return { models: {} };
  }
  return load(readFileSync(configPath, 'utf-8')) as ModelsConfigFile;
}

/**
 * 加载 pricing.yaml
 */
export function loadPricingConfig(): PricingConfigFile {
  const configPath = join(resolvePyappHome(), 'pricing.yaml');
  if (!existsSync(configPath)) {
    return { pricing: {} };
  }
  return load(readFileSync(configPath, 'utf-8')) as PricingConfigFile;
}
