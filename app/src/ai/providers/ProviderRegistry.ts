import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import type { AIProvider, ProviderConfig } from './AIProvider';

const logger = new Logger({ level: LogLevel.INFO });

export class ProviderRegistry {
  private providers: Map<string, AIProvider> = new Map();
  private defaultProviderId: string | null = null;

  /**
   * 模型前缀 → Provider ID 映射表（按优先级排序）
   * getByModel() 依次匹配，返回第一个命中
   */
  private modelToProvider: Array<[string, string]> = [
    ['claude-', 'anthropic'],
    ['opus', 'anthropic'],
    ['sonnet', 'anthropic'],
    ['haiku', 'anthropic'],
    ['gpt-', 'openai'],
    ['o1', 'openai'],
    ['o3', 'openai'],
    ['o4', 'openai'],
    ['gemini-', 'google'],
    ['deepseek', 'deepseek'],
    ['azure-', 'azure-openai'],
    ['moonshot', 'moonshot'],
    ['grok', 'grok'],
    ['bedrock-', 'bedrock'],
    ['vertex-', 'vertex-ai'],
    ['qwen', 'ollama'],
    ['llama', 'ollama'],
    ['mistral', 'ollama'],
  ];

  register(provider: AIProvider): void {
    if (this.providers.has(provider.id)) {
      logger.warning(
        `Provider already registered, overwriting: ${provider.id}`
      );
    }
    this.providers.set(provider.id, provider);
    logger.info(
      `Provider registered: ${provider.id} (${provider.displayName})`
    );
    if (!this.defaultProviderId) {
      this.defaultProviderId = provider.id;
    }
  }

  unregister(providerId: string): boolean {
    const removed = this.providers.delete(providerId);
    if (removed) {
      logger.info(`Provider unregistered: ${providerId}`);
      if (this.defaultProviderId === providerId) {
        this.defaultProviderId =
          this.providers.size > 0
            ? (this.providers.keys().next().value ?? null)
            : null;
      }
    }
    return removed;
  }

  get(providerId: string): AIProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new AppError(
        `Provider not found: ${providerId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    return provider;
  }

  has(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  /**
   * 按模型名自动匹配 Provider
   * 遍历 modelToProvider 映射表，返回第一个匹配的已注册 Provider
   */
  getByModel(model: string): AIProvider | undefined {
    const normalized = model.toLowerCase();
    for (const [prefix, providerId] of this.modelToProvider) {
      if (normalized.startsWith(prefix) && this.providers.has(providerId)) {
        return this.providers.get(providerId);
      }
    }
    return undefined;
  }

  /**
   * 获取或创建 Provider — 吸收旧 LLMClientFactory 的 createClient 逻辑
   */
  getOrCreate(providerId: string, config?: ProviderConfig): AIProvider {
    if (this.has(providerId)) {
      return this.get(providerId);
    }
    // 动态创建（import 延迟加载，避免循环依赖）
    const createFn = this.getCreatorFn(providerId);
    if (createFn) {
      const provider = createFn(config || {});
      this.register(provider);
      return provider;
    }
    throw new AppError(
      `Cannot create provider: ${providerId}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }

  private getCreatorFn(
    providerId: string
  ): ((config: ProviderConfig) => AIProvider) | null {
    switch (providerId) {
      case 'anthropic':
        return (cfg) => {
          const { AnthropicProvider: AP } = require('./AnthropicProvider');
          return new AP(cfg);
        };
      case 'openai':
        return (cfg) => {
          const { OpenAIProvider: OP } = require('./OpenAIProvider');
          return new OP(cfg);
        };
      case 'google':
        return (cfg) => {
          const { GoogleProvider: GP } = require('./GoogleProvider');
          return new GP(cfg);
        };
      case 'deepseek':
        return (cfg) => {
          const { DeepSeekProvider: DSP } = require('./DeepSeekProvider');
          return new DSP(cfg);
        };
      case 'bedrock':
        return (cfg) => {
          const { BedrockProvider: BP } = require('./BedrockProvider');
          return new BP(cfg);
        };
      case 'azure-openai':
        return (cfg) => {
          const { AzureOpenAIProvider: AZ } = require('./AzureOpenAIProvider');
          return new AZ(cfg);
        };
      case 'moonshot':
        return (cfg) => {
          const { MoonshotProvider: MP } = require('./MoonshotProvider');
          return new MP(cfg);
        };
      case 'grok':
        return (cfg) => {
          const { GrokProvider: GP } = require('./GrokProvider');
          return new GP(cfg);
        };
      case 'ollama':
        return (cfg) => {
          const { OllamaProvider: OP } = require('./OllamaProvider');
          return new OP(cfg);
        };
      case 'vertex-ai':
        return (cfg) => {
          const { VertexAIProvider: VP } = require('./VertexAIProvider');
          return new VP(cfg);
        };
      default:
        return null;
    }
  }

  list(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  listIds(): string[] {
    return Array.from(this.providers.keys());
  }

  getDefaultProvider(): AIProvider {
    if (!this.defaultProviderId) {
      throw new AppError(
        'No providers registered',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    return this.get(this.defaultProviderId);
  }

  setDefaultProvider(providerId: string): void {
    if (!this.providers.has(providerId)) {
      throw new AppError(
        `Cannot set default: provider not found: ${providerId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    this.defaultProviderId = providerId;
    logger.info(`Default provider set to: ${providerId}`);
  }

  getDefaultProviderId(): string | null {
    return this.defaultProviderId;
  }

  clear(): void {
    this.providers.clear();
    this.defaultProviderId = null;
    logger.info('All providers cleared');
  }

  get size(): number {
    return this.providers.size;
  }
}

export const providerRegistry = new ProviderRegistry();
