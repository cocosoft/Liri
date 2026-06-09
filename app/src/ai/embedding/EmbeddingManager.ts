/**
 * 嵌入模型管理器
 * 统一管理多个嵌入提供者，支持按需选择和降级
 * 零启动开销：仅在使用时初始化
 */

import {
  EmbeddingBase,
  EmbeddingOptions,
  EmbeddingResult,
} from './EmbeddingBase';
import { OpenAIEmbeddingProvider } from './providers/OpenAIEmbeddingProvider';
import type { OpenAIEmbeddingConfig } from './providers/OpenAIEmbeddingProvider';
import { configManager } from '@modules/config';

/**
 * 嵌入模型配置
 */
export interface EmbeddingConfig {
  /** 默认提供者类型 */
  defaultProvider?: 'openai' | 'local';
  /** OpenAI 配置 */
  openai?: OpenAIEmbeddingConfig;
}

/**
 * 嵌入模型管理器
 * 按需初始化提供者，无启动开销
 */
export class EmbeddingManager {
  private providers: Map<string, EmbeddingBase> = new Map();

  private defaultProviderId: string = 'openai';

  private initialized: boolean = false;

  /**
   * 初始化嵌入模块
   * 延迟初始化：仅注册提供者工厂，不实际创建
   */
  initialize(config?: EmbeddingConfig): void {
    if (this.initialized) return;

    if (config?.defaultProvider) {
      this.defaultProviderId = config.defaultProvider;
    }

    // 注册内置提供者工厂
    if (config?.openai || configManager.env('OPENAI_API_KEY')) {
      const provider = new OpenAIEmbeddingProvider(config?.openai);
      this.providers.set('openai', provider);
    }

    this.initialized = true;
  }

  /**
   * 获取指定提供者
   */
  getProvider(id?: string): EmbeddingBase {
    this.ensureInitialized();

    const providerId = id || this.defaultProviderId;
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new Error(
        `嵌入提供者未注册: ${providerId}。请先设置 OPENAI_API_KEY 环境变量或调用 initialize() 配置。`
      );
    }

    return provider;
  }

  /**
   * 文本嵌入
   */
  async embed(
    texts: string[],
    options?: EmbeddingOptions & { provider?: string }
  ): Promise<EmbeddingResult> {
    const provider = this.getProvider(options?.provider);
    return provider.embed(texts, options);
  }

  /**
   * 单文本嵌入（便捷方法）
   */
  async embedOne(
    text: string,
    options?: EmbeddingOptions & { provider?: string }
  ): Promise<number[]> {
    const provider = this.getProvider(options?.provider);
    return provider.embedOne(text, options);
  }

  /**
   * 检查是否有可用提供者
   */
  async isAvailable(): Promise<boolean> {
    if (!this.initialized) return false;

    for (const provider of this.providers.values()) {
      if (await provider.isAvailable()) return true;
    }
    return false;
  }

  /**
   * 注册自定义提供者
   */
  registerProvider(id: string, provider: EmbeddingBase): void {
    this.providers.set(id, provider);
  }

  /**
   * 获取所有已注册提供者
   */
  getProviders(): Map<string, EmbeddingBase> {
    return new Map(this.providers);
  }

  /**
   * 确保已初始化
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      // 自动使用环境变量初始化
      this.initialize();
    }
  }
}

/**
 * 全局嵌入模型管理器实例
 */
export const globalEmbeddingManager = new EmbeddingManager();
