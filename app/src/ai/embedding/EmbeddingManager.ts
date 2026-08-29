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
import { LocalEmbeddingProvider } from './providers/LocalEmbeddingProvider';
import type { OpenAIEmbeddingConfig } from './providers/OpenAIEmbeddingProvider';
import { configManager } from '@modules/config';
// 模块内部引用用相对路径，避免 @modules/ai ↔ embedding 自环（导致加载顺序不定）
import { providerRegistry } from '../providers/ProviderRegistry';
import { resolveModelRoute, RouteKey } from '../router/resolveModelRoute';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('ai:embedding:EmbeddingManager');

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
 *
 * 核心变更：不再硬编码 'openai' 作为默认提供者，改为通过 ModelRouter
 * 读取用户在前端配置的"嵌入"任务模型，动态选择对应的嵌入 Provider。
 * 确保"任务分工→嵌入"配置真正生效。
 */
export class EmbeddingManager {
  private providers: Map<string, EmbeddingBase> = new Map();

  private defaultProviderId: string = 'local';

  private initialized: boolean = false;

  /**
   * 初始化嵌入模块
   * 根据用户在前端"任务分工→嵌入"配置的模型，动态选择嵌入 Provider。
   * 优先级：用户配置 > 本地回退。
   */
  async initialize(config?: EmbeddingConfig): Promise<void> {
    if (this.initialized) return;

    // 注册本地提供者（Ollama 等），始终可用
    this.providers.set('local', new LocalEmbeddingProvider());

    // 从统一模型路由读取用户在前端"任务分工→嵌入"配置的模型
    const resolved = await this._resolveEmbeddingProvider(config);
    if (resolved.type === 'openai' && resolved.apiKey) {
      this.providers.set(
        'openai',
        new OpenAIEmbeddingProvider({
          apiKey: resolved.apiKey,
          baseURL: resolved.baseUrl,
          // KB-EMBED-MODEL（2026-08-28）：必须传任务分工配置的模型 ID（如 BAAI/bge-m3），
          // 否则默认 text-embedding-3-small 请求硅基流动等 Provider 会报模型不存在
          model: resolved.model,
          ...(config?.openai || {}),
        })
      );
    }

    // 设置默认提供者：用户配置的 Provider 优先，否则降级到 local
    this.defaultProviderId = this.providers.has(resolved.type)
      ? resolved.type
      : 'local';

    this.initialized = true;
    // KB-SEM-LOG（2026-08-28）：记录最终选中的嵌入提供者——排查"嵌入服务不可用"
    // 时先看此日志确认走 local(Ollama) 还是远端 OpenAI-compat
    logger.info('EmbeddingManager 初始化完成', {
      resolvedType: resolved.type,
      defaultProviderId: this.defaultProviderId,
      registered: [...this.providers.keys()],
    });
  }

  /**
   * 解析嵌入 Provider
   * 通过 ModelRouter 读取用户配置的嵌入任务模型，再经 ProviderRegistry
   * 映射到具体 Provider，最后从环境变量提取 API 凭据。
   */
  private async _resolveEmbeddingProvider(config?: EmbeddingConfig): Promise<{
    type: 'openai' | 'local';
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  }> {
    // 优先使用构造参数中明确的 defaultProvider
    if (config?.defaultProvider === 'local') {
      return { type: 'local' };
    }

    // 通过统一模型路由读取用户在前端"任务分工→嵌入"配置的模型
    const modelId = await resolveModelRoute(RouteKey.EMBEDDING);
    if (!modelId) {
      return { type: 'local' };
    }

    // 查找模型对应的 Provider（如 deepseek-v4-pro → deepseek Provider）
    const provider = providerRegistry.getByModel(modelId);
    if (!provider) {
      return { type: 'local' };
    }

    const pid = provider.id;

    // Ollama / 本地模型 → 使用本地嵌入（Ollama 的 nomic-embed-text）
    if (pid === 'ollama') {
      return { type: 'local' };
    }

    // 其他 Provider（openai, deepseek 等）→ 使用对应 Provider 的 API 凭据
    // 优先取 provider 实例的 apiKey/baseUrl（ProviderSyncService 已从 DB 注入），
    // 环境变量仅作兜底（历史配置可能只设置环境变量）
    const providerCreds = provider as unknown as {
      apiKey?: string;
      baseUrl?: string;
    };
    const upper = pid.toUpperCase().replace(/-/g, '_');
    const apiKey =
      providerCreds.apiKey || configManager.env(`${upper}_API_KEY`);
    const baseUrl =
      providerCreds.baseUrl || configManager.env(`${upper}_BASE_URL`);

    // 无 API key 时降级到本地
    if (!apiKey) {
      // KB-EMBED-LOG（2026-08-28）：记录降级原因——排查"已配置嵌入模型却报
      // embedding 失败"时，此日志直接揭示是否因拿不到 provider 凭据降级到本地
      logger.warning('嵌入 Provider 无 API Key，降级到本地(Ollama)', {
        modelId,
        providerId: pid,
        hasInstanceApiKey: !!providerCreds.apiKey,
        hasEnvApiKey: !!configManager.env(`${upper}_API_KEY`),
      });
      return { type: 'local' };
    }

    logger.info('嵌入任务解析为远端 OpenAI-compat Provider', {
      modelId,
      providerId: pid,
      baseUrl: baseUrl || '(env 未配置，将使用默认)',
      hasApiKey: !!apiKey,
    });
    return { type: 'openai', apiKey, baseUrl, model: modelId };
  }

  /**
   * 获取指定提供者
   */
  async getProvider(id?: string): Promise<EmbeddingBase> {
    await this.ensureInitialized();

    const providerId = id || this.defaultProviderId;
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new Error(
        `嵌入提供者未注册: ${providerId}。请在"模型管理→任务分工"中为"嵌入"任务配置一个有效的 Provider。`
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
    const provider = await this.getProvider(options?.provider);
    return provider.embed(texts, options);
  }

  /**
   * 单文本嵌入（便捷方法）
   */
  async embedOne(
    text: string,
    options?: EmbeddingOptions & { provider?: string }
  ): Promise<number[]> {
    const provider = await this.getProvider(options?.provider);
    return provider.embedOne(text, options);
  }

  /**
   * 检查是否有可用提供者
   */
  async isAvailable(): Promise<boolean> {
    await this.ensureInitialized();

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
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      // 自动使用环境变量初始化
      await this.initialize();
    }
  }
}

/**
 * 全局嵌入模型管理器实例
 */
export const globalEmbeddingManager = new EmbeddingManager();
