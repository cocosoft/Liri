import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import type { AIProvider, ProviderConfig } from './AIProvider';

const logger = new Logger({ level: LogLevel.INFO });

export class ProviderRegistry {
  private providers: Map<string, AIProvider> = new Map();
  private defaultProviderId: string | null = null;

  /**
   * DB 同步 Provider 的类型别名映射
   * providerType (如 'ollama') → registryId (如 'db:uuid')
   * 使 getByModel() 能通过模型前缀查找 DB 同步的 Provider
   */
  private providerTypeToId: Map<string, string> = new Map();

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
      // 清理该 provider 在类型别名映射中的条目
      for (const [type, id] of this.providerTypeToId) {
        if (id === providerId) {
          this.providerTypeToId.delete(type);
          break;
        }
      }
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
   *
   * 匹配优先级:
   *   1. 直接 ID 匹配（如 'deepseek'）
   *   2. 类型别名匹配（DB 同步的 Provider，如 'ollama' → 'db:uuid'）
   */
  getByModel(model: string): AIProvider | undefined {
    const normalized = model.toLowerCase();
    for (const [prefix, providerId] of this.modelToProvider) {
      if (normalized.startsWith(prefix)) {
        // 优先：直接 ID 匹配
        if (this.providers.has(providerId)) {
          return this.providers.get(providerId);
        }
        // 回退：类型别名匹配（DB 同步的 Provider）
        const aliasedId = this.providerTypeToId.get(providerId);
        if (aliasedId && this.providers.has(aliasedId)) {
          return this.providers.get(aliasedId);
        }
      }
    }
    logger.debug(`模型未匹配到 Provider: ${model}`);
    return undefined;
  }

  /**
   * 根据模型名解析对应 Provider ID（仅查映射表，不检查是否已注册）
   *
   * 用于调用方在 getByModel() 返回 undefined 后，
   * 通过 getOrCreate() 动态创建未注册的 Provider。
   * 消除 aiService.ts 中重复的 startsWith 硬编码。
   *
   * @param model 模型名
   * @returns Provider ID，无匹配返回 undefined
   */
  resolveModelToProviderId(model: string): string | undefined {
    const normalized = model.toLowerCase();
    for (const [prefix, providerId] of this.modelToProvider) {
      if (normalized.startsWith(prefix)) {
        return providerId;
      }
    }
    return undefined;
  }

  /**
   * 按 provider 类型查找（用于 DB 同步的场景）
   * 例如 getByType('ollama') 返回最后一个同步的 ollama Provider
   */
  getByType(providerType: string): AIProvider | undefined {
    const registryId = this.providerTypeToId.get(providerType);
    if (registryId && this.providers.has(registryId)) {
      return this.providers.get(registryId);
    }
    // 降级：直接 ID 匹配（兼容硬编码注册的 Provider）
    if (this.providers.has(providerType)) {
      return this.providers.get(providerType);
    }
    return undefined;
  }

  /**
   * 设置 DB 同步 Provider 的类型别名
   * 每个 providerType 只有一个活跃别名（后注册覆盖前注册）
   */
  setProviderTypeAlias(providerType: string, registryId: string): void {
    this.providerTypeToId.set(providerType, registryId);
  }

  /** 移除 Provider 类型别名 */
  removeProviderTypeAlias(providerType: string): void {
    this.providerTypeToId.delete(providerType);
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
          return new AP({
            providerId: 'anthropic',
            displayName: 'Anthropic Claude',
            defaultBaseUrl: 'https://api.anthropic.com',
            envApiKey: 'ANTHROPIC_API_KEY',
            defaultModel: (cfg?.model as string) || '',
          });
        };
      case 'openai':
        return (cfg) => {
          const { OpenAIProvider: OP } = require('./OpenAIProvider');
          return new OP({
            providerId: 'openai',
            displayName: 'OpenAI',
            defaultBaseUrl: 'https://api.openai.com/v1',
            envApiKey: 'OPENAI_API_KEY',
            defaultModel: (cfg?.model as string) || '',
          });
        };
      case 'google':
        return (cfg) => {
          const { GoogleProvider: GP } = require('./GoogleProvider');
          return new GP({
            providerId: 'google',
            displayName: 'Google Gemini',
            defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
            envApiKey: 'GOOGLE_API_KEY',
            defaultModel: (cfg?.model as string) || '',
          });
        };
      case 'deepseek':
        return (cfg) => {
          const { DeepSeekProvider: DSP } = require('./DeepSeekProvider');
          return new DSP({
            providerId: 'deepseek',
            displayName: 'DeepSeek',
            defaultBaseUrl: 'https://api.deepseek.com',
            envApiKey: 'DEEPSEEK_API_KEY',
            defaultModel: (cfg?.model as string) || 'deepseek-v4-flash',
          });
        };
      case 'bedrock':
        return (cfg) => {
          const { BedrockProvider: BP } = require('./BedrockProvider');
          return new BP({
            providerId: 'bedrock',
            displayName: 'AWS Bedrock',
            defaultModel: (cfg?.model as string) || '',
          }, cfg);
        };
      case 'azure-openai':
        return (cfg) => {
          const { AzureOpenAIProvider: AZ } = require('./AzureOpenAIProvider');
          return new AZ({
            providerId: 'azure-openai',
            displayName: 'Azure OpenAI',
            defaultModel: (cfg?.model as string) || '',
          }, cfg);
        };
      case 'moonshot':
        return (cfg) => {
          const { MoonshotProvider: MP } = require('./MoonshotProvider');
          return new MP({
            providerId: 'moonshot',
            displayName: 'Moonshot (Kimi)',
            defaultBaseUrl: 'https://api.moonshot.cn/v1',
            envApiKey: 'MOONSHOT_API_KEY',
            defaultModel: (cfg?.model as string) || '',
          });
        };
      case 'grok':
        return (cfg) => {
          const { GrokProvider: GP } = require('./GrokProvider');
          return new GP({
            providerId: 'grok',
            displayName: 'Grok (X.AI)',
            defaultBaseUrl: 'https://api.x.ai/v1',
            envApiKey: 'GROK_API_KEY',
            defaultModel: (cfg?.model as string) || '',
          });
        };
      case 'ollama':
        return (cfg) => {
          const { OllamaProvider: OP } = require('./OllamaProvider');
          return new OP({
            providerId: 'ollama',
            displayName: 'Ollama (Local)',
            defaultBaseUrl: 'http://localhost:11434',
            defaultModel: (cfg?.model as string) || '',
          });
        };
      case 'vertex-ai':
        return (cfg) => {
          const { VertexAIProvider: VP } = require('./VertexAIProvider');
          return new VP({
            providerId: 'vertex-ai',
            displayName: 'Google Vertex AI',
            defaultBaseUrl: 'https://us-central1-aiplatform.googleapis.com',
            defaultModel: (cfg?.model as string) || '',
          }, cfg);
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
    this.providerTypeToId.clear();
    logger.info('All providers cleared');
  }

  get size(): number {
    return this.providers.size;
  }
}

export const providerRegistry = new ProviderRegistry();
