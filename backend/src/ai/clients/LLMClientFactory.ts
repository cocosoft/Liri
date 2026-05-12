/**
 * LLM客户端工厂
 * 支持创建多种API客户端（Anthropic、AWS、Azure、Vertex等）
 *
 * 基于CC源码 cc_code/backend/services/api/client.ts 实现
 */

import { LLMClient } from './LLMClient';
import { DeepSeekClient } from './DeepSeekClient';
import { AnthropicClient } from './AnthropicClient';
import { OpenAIClient } from './openaiClient';
import { AWSClient } from './AWSClient';
import { AzureClient } from './AzureClient';
import { VertexClient } from './VertexClient';
import { getConfig } from '@modules/config';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

export interface AnthropicConfig {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  timeout?: number;
}

export interface AWSConfig {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

export interface AzureConfig {
  resourceName: string;
  apiKey: string;
  apiVersion?: string;
  baseUrl?: string;
}

export interface VertexConfig {
  projectId: string;
  region: string;
  credentials?: {
    clientEmail?: string;
    privateKey?: string;
  };
}

export interface OpenAIConfig {
  apiKey: string;
  baseUrl?: string;
  organization?: string;
}

export interface DeepSeekConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export type LLMClientType =
  | 'anthropic'
  | 'aws'
  | 'azure'
  | 'vertex'
  | 'openai'
  | 'deepseek';

export interface LLMClientFactory {
  createClient(type: LLMClientType, config?: any): LLMClient;
  getDefaultClient(): LLMClient;
  getClientForProvider(provider: string): LLMClient;
  hasClient(type: LLMClientType): boolean;
}

export class DefaultLLMClientFactory implements LLMClientFactory {
  private clients: Map<LLMClientType, LLMClient> = new Map();
  private defaultClient: LLMClient | null = null;
  private defaultsRegistered = false;

  private ensureDefaultClients(): void {
    if (this.defaultsRegistered) return;
    this.defaultsRegistered = true;

    try {
      // 从配置获取 DeepSeek 配置
      const config = getConfig();
      const aiConfig = config.ai;

      // 创建 DeepSeek 客户端（默认）
      const deepseekConfig: DeepSeekConfig = {
        apiKey:
          aiConfig?.deepseek?.apiKey || process.env.DEEPSEEK_API_KEY || '',
        baseUrl:
          aiConfig?.deepseek?.baseUrl ||
          process.env.DEEPSEEK_BASE_URL ||
          'https://api.deepseek.com',
        model: aiConfig?.deepseek?.model || 'deepseek-chat',
      };

      if (deepseekConfig.apiKey) {
        const deepseekClient = new DeepSeekClient(deepseekConfig);
        this.clients.set('deepseek', deepseekClient);
        this.defaultClient = deepseekClient;
      } else {
        console.warn('DeepSeek API key not configured');
      }
    } catch (error) {
      console.error('Failed to register default DeepSeek client:', error);
    }
  }

  createClient(type: LLMClientType, config?: any): LLMClient {
    // 如果没有传入配置，尝试从系统配置获取
    if (!config) {
      const systemConfig = getConfig();
      const aiConfig = systemConfig.ai;

      switch (type) {
        case 'deepseek':
          config = {
            apiKey:
              aiConfig?.deepseek?.apiKey || process.env.DEEPSEEK_API_KEY || '',
            baseUrl:
              aiConfig?.deepseek?.baseUrl ||
              process.env.DEEPSEEK_BASE_URL ||
              'https://api.deepseek.com',
            model: aiConfig?.deepseek?.model || 'deepseek-chat',
          };
          break;
        case 'openai':
          config = {
            apiKey:
              aiConfig?.openai?.apiKey || process.env.OPENAI_API_KEY || '',
            baseUrl: aiConfig?.openai?.baseUrl || 'https://api.openai.com/v1',
          };
          break;
        case 'anthropic':
          config = {
            apiKey:
              aiConfig?.anthropic?.apiKey ||
              process.env.ANTHROPIC_API_KEY ||
              '',
            baseUrl:
              aiConfig?.anthropic?.baseUrl || 'https://api.anthropic.com',
          };
          break;
        case 'azure':
          config = {
            resourceName: aiConfig?.azure?.resourceName || '',
            apiKey: aiConfig?.azure?.apiKey || '',
            apiVersion: aiConfig?.azure?.apiVersion || '2024-02-15-preview',
            baseUrl: aiConfig?.azure?.baseUrl,
          };
          break;
        case 'vertex':
          config = {
            projectId: aiConfig?.vertex?.projectId || '',
            region: aiConfig?.vertex?.region || 'us-central1',
            credentials: aiConfig?.vertex?.credentials,
          };
          break;
      }
    }

    switch (type) {
      case 'deepseek':
        return this.createDeepSeekClient(config);
      case 'openai':
        return this.createOpenAIClient(config);
      case 'anthropic':
        return this.createAnthropicClient(config);
      case 'aws':
        return this.createAWSClient(config);
      case 'azure':
        return this.createAzureClient(config);
      case 'vertex':
        return this.createVertexClient(config);
      default:
        throw new AppError(`Unsupported client type: ${type}`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }
  }

  getClientForProvider(provider: string): LLMClient {
    this.ensureDefaultClients();
    const type = provider.toLowerCase() as LLMClientType;

    // 如果已存在该类型的客户端，直接返回
    if (this.clients.has(type)) {
      return this.clients.get(type)!;
    }

    // 否则创建新的客户端
    return this.createClient(type);
  }

  private createDeepSeekClient(config?: DeepSeekConfig): LLMClient {
    const client = new DeepSeekClient(config);
    this.clients.set('deepseek', client);
    return client;
  }

  private createOpenAIClient(config: OpenAIConfig): LLMClient {
    const client = new OpenAIClient(config as any);
    this.clients.set('openai', client);
    return client;
  }

  private createAnthropicClient(config: AnthropicConfig): LLMClient {
    const client = new AnthropicClient(config as any);
    this.clients.set('anthropic', client);
    return client;
  }

  private createAWSClient(config: AWSConfig): LLMClient {
    const client = new AWSClient(config as any);
    this.clients.set('aws', client);
    return client;
  }

  private createAzureClient(config: AzureConfig): LLMClient {
    const client = new AzureClient(config as any);
    this.clients.set('azure', client);
    return client;
  }

  private createVertexClient(config: VertexConfig): LLMClient {
    const client = new VertexClient(config as any);
    this.clients.set('vertex', client);
    return client;
  }

  getDefaultClient(): LLMClient {
    this.ensureDefaultClients();
    if (!this.defaultClient) {
      this.defaultClient = new DeepSeekClient();
      this.clients.set('deepseek', this.defaultClient);
    }
    return this.defaultClient as LLMClient;
  }

  hasClient(type: LLMClientType): boolean {
    this.ensureDefaultClients();
    return this.clients.has(type);
  }

  getClient(type: LLMClientType): LLMClient | undefined {
    this.ensureDefaultClients();
    return this.clients.get(type);
  }

  setDefaultClient(client: LLMClient): void {
    this.defaultClient = client;
  }

  getAvailableClients(): LLMClientType[] {
    this.ensureDefaultClients();
    return Array.from(this.clients.keys());
  }
}

let globalFactory: LLMClientFactory | null = null;

export function getLLMClientFactory(): LLMClientFactory {
  if (!globalFactory) {
    globalFactory = new DefaultLLMClientFactory();
  }
  return globalFactory;
}

export function setLLMClientFactory(factory: LLMClientFactory): void {
  globalFactory = factory;
}

export function createLLMClient(type: LLMClientType, config?: any): LLMClient {
  return getLLMClientFactory().createClient(type, config);
}
