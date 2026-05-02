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

export type LLMClientType =
  | 'anthropic'
  | 'aws'
  | 'azure'
  | 'vertex'
  | 'openai'
  | 'deepseek';

export interface LLMClientFactory {
  createClient(type: LLMClientType, config: any): LLMClient;
  getDefaultClient(): LLMClient;
  hasClient(type: LLMClientType): boolean;
}

export class DefaultLLMClientFactory implements LLMClientFactory {
  private clients: Map<LLMClientType, LLMClient> = new Map();
  private defaultClient: LLMClient | null = null;

  constructor() {
    this.registerDefaultClients();
  }

  private registerDefaultClients(): void {
    try {
      const deepseekClient = new DeepSeekClient();
      this.clients.set('deepseek', deepseekClient);
      this.defaultClient = deepseekClient;
    } catch (error) {
      console.error('Failed to register default DeepSeek client:', error);
    }
  }

  createClient(type: LLMClientType, config: any): LLMClient {
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
        throw new Error(`Unsupported client type: ${type}`);
    }
  }

  private createDeepSeekClient(config?: any): LLMClient {
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
    if (!this.defaultClient) {
      this.defaultClient = new DeepSeekClient();
      this.clients.set('deepseek', this.defaultClient);
    }
    return this.defaultClient as LLMClient;
  }

  hasClient(type: LLMClientType): boolean {
    return this.clients.has(type);
  }

  getClient(type: LLMClientType): LLMClient | undefined {
    return this.clients.get(type);
  }

  setDefaultClient(client: LLMClient): void {
    this.defaultClient = client;
  }

  getAvailableClients(): LLMClientType[] {
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
