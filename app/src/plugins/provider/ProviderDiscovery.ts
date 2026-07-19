/**
 * ProviderDiscovery 提供者发现
 * 自动发现可用 AI 提供者，支持静态注册和动态扫描
 */
import {
  providerCatalog,
  type ProviderMetadata,
  type ProviderType,
} from './ProviderCatalog.js';
import { configManager } from '@modules/config';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'plugins:provider:ProviderDiscovery',
  level: LogLevel.INFO,
});

/**
 * 发现策略
 */
export type DiscoveryStrategy =
  | 'static'
  | 'config'
  | 'environment'
  | 'network'
  | 'plugin';

/**
 * 发现结果
 */
export interface DiscoveryResult {
  provider: ProviderMetadata;
  strategy: DiscoveryStrategy;
  confidence: number;
}

/**
 * 提供者发现管理器
 */
export class ProviderDiscovery {
  private customProviders: ProviderMetadata[] = [];
  private scanned: boolean = false;

  /**
   * 注册自定义提供者
   */
  registerCustom(provider: ProviderMetadata): void {
    this.customProviders.push(provider);
  }

  /**
   * 执行全面发现
   */
  discover(): DiscoveryResult[] {
    const results: DiscoveryResult[] = [];

    results.push(...this.discoverFromBuiltin());
    results.push(...this.discoverFromConfig());
    results.push(...this.discoverFromEnvironment());
    results.push(...this.discoverFromCustom());

    for (const result of results) {
      providerCatalog.register(result.provider);
    }

    this.scanned = true;
    return results;
  }

  /**
   * 是否已完成扫描
   */
  hasScanned(): boolean {
    return this.scanned;
  }

  /**
   * 获取发现的提供者数量
   */
  count(): number {
    return providerCatalog.count() + this.customProviders.length;
  }

  /**
   * 从内置列表发现
   */
  private discoverFromBuiltin(): DiscoveryResult[] {
    const builtinProviders: ProviderMetadata[] = [
      {
        id: 'openai',
        name: 'OpenAI',
        description: 'OpenAI GPT 系列模型',
        version: '1.0.0',
        type: 'llm',
        capabilities: [
          {
            type: 'llm',
            models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
            maxTokens: 128000,
            supportsStreaming: true,
            supportsFunctions: true,
            supportsVision: true,
          },
        ],
        authMethods: ['api-key'],
        baseUrl: 'https://api.openai.com/v1',
        status: 'active',
        priority: 100,
      },
      {
        id: 'anthropic',
        name: 'Anthropic',
        description: 'Anthropic Claude 系列模型',
        version: '1.0.0',
        type: 'llm',
        capabilities: [
          {
            type: 'llm',
            models: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
            maxTokens: 200000,
            supportsStreaming: true,
            supportsFunctions: true,
            supportsVision: true,
          },
        ],
        authMethods: ['api-key'],
        baseUrl: 'https://api.anthropic.com/v1',
        status: 'active',
        priority: 90,
      },
      {
        id: 'azure-openai',
        name: 'Azure OpenAI',
        description: 'Microsoft Azure OpenAI 服务',
        version: '1.0.0',
        type: 'llm',
        capabilities: [
          {
            type: 'llm',
            models: [],
            maxTokens: 128000,
            supportsStreaming: true,
            supportsFunctions: true,
          },
        ],
        authMethods: ['api-key', 'bearer'],
        baseUrl: 'https://<resource>.openai.azure.com',
        status: 'active',
        priority: 80,
      },
      {
        id: 'google-ai',
        name: 'Google AI',
        description: 'Google Gemini 系列模型',
        version: '1.0.0',
        type: 'llm',
        capabilities: [
          {
            type: 'llm',
            models: ['gemini-pro', 'gemini-ultra', 'gemini-nano'],
            maxTokens: 32768,
            supportsStreaming: true,
            supportsVision: true,
          },
        ],
        authMethods: ['api-key'],
        baseUrl: 'https://generativelanguage.googleapis.com',
        status: 'active',
        priority: 70,
      },
    ];

    return builtinProviders.map((p) => ({
      provider: p,
      strategy: 'static' as DiscoveryStrategy,
      confidence: 1.0,
    }));
  }

  /**
   * 从配置文件发现
   */
  private discoverFromConfig(): DiscoveryResult[] {
    const results: DiscoveryResult[] = [];

    try {
      const configPath = configManager.env('LIRI_PROVIDER_CONFIG');
      if (!configPath) return results;

      const fs = require('fs');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (Array.isArray(config.providers)) {
          for (const p of config.providers) {
            results.push({
              provider: p,
              strategy: 'config',
              confidence: 0.9,
            });
          }
        }
      }
    } catch (err) {
      // 忽略配置读取错误

      logger.debug('Operation skipped', {
        context: '忽略配置读取错误',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return results;
  }

  /**
   * 从环境变量发现
   */
  private discoverFromEnvironment(): DiscoveryResult[] {
    const results: DiscoveryResult[] = [];

    if (configManager.env('OPENAI_API_KEY')) {
      results.push({
        provider: {
          id: 'openai-env',
          name: 'OpenAI (ENV)',
          description: '通过环境变量配置的 OpenAI',
          version: '1.0.0',
          type: 'llm',
          capabilities: [
            {
              type: 'llm',
              models: [],
              maxTokens: 128000,
              supportsStreaming: true,
              supportsFunctions: true,
            },
          ],
          authMethods: ['api-key'],
          baseUrl: 'https://api.openai.com/v1',
          status: 'active',
          priority: 50,
        },
        strategy: 'environment',
        confidence: 0.8,
      });
    }

    if (configManager.env('ANTHROPIC_API_KEY')) {
      results.push({
        provider: {
          id: 'anthropic-env',
          name: 'Anthropic (ENV)',
          description: '通过环境变量配置的 Anthropic',
          version: '1.0.0',
          type: 'llm',
          capabilities: [
            {
              type: 'llm',
              models: ['claude-3-opus', 'claude-3-sonnet'],
              maxTokens: 200000,
              supportsStreaming: true,
              supportsFunctions: true,
            },
          ],
          authMethods: ['api-key'],
          baseUrl: 'https://api.anthropic.com/v1',
          status: 'active',
          priority: 50,
        },
        strategy: 'environment',
        confidence: 0.8,
      });
    }

    return results;
  }

  /**
   * 从自定义注册发现
   */
  private discoverFromCustom(): DiscoveryResult[] {
    return this.customProviders.map((p) => ({
      provider: p,
      strategy: 'plugin' as DiscoveryStrategy,
      confidence: 0.7,
    }));
  }
}

export const providerDiscovery = new ProviderDiscovery();
