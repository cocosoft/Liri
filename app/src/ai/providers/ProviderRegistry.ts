import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import type { AIProvider, ProviderConfig } from './AIProvider';

const logger = getLogger('ai:providerRegistry');

export class ProviderRegistry {
  private providers: Map<string, AIProvider> = new Map();
  private defaultProviderId: string | null = null;

  /**
   * DB 同步 Provider 的类型别名映射
   * providerType (如 'ollama') → registryId (如 'db:uuid')
   * 使 getByModel() 能通过 providerType 查找 DB 同步的 Provider
   */
  private providerTypeToId: Map<string, string> = new Map();

  /**
   * 模型名 → Provider 类型映射表（数据来源：model_registry 表）
   * 在 syncDBProvidersToRegistry 时从 DB 同步填充。
   * 精确匹配，不做前缀推断。
   */
  private modelToProviderType: Map<string, string> = new Map();

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

  /**
   * 原子替换已注册的 Provider（同 id 覆盖，单次 Map 操作无 unregister→register 间隙）。
   * 与 register() 的区别：替换已存在 provider 时保留默认状态，避免默认 provider 漂移。
   */
  replace(provider: AIProvider): void {
    const existed = this.providers.has(provider.id);
    this.providers.set(provider.id, provider);
    if (!existed && !this.defaultProviderId) {
      this.defaultProviderId = provider.id;
    }
    logger.info(
      `Provider replaced: ${provider.id} (${provider.displayName})`
    );
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
   * 按模型名精确匹配 Provider
   *
   * 数据来源：model_registry.model_id → providerType，在 syncDBProvidersToRegistry 时同步。
   * 查找优先级:
   *   1. modelToProviderType 精确匹配 → providerType
   *   2. providerType → providers 直接 ID 匹配
   *   3. providerType → providerTypeToId 别名匹配（DB 同步的 Provider）
   */
  getByModel(model: string): AIProvider | undefined {
    const providerType = this.modelToProviderType.get(model.toLowerCase());
    if (!providerType) return undefined;

    // 优先：直接 ID 匹配
    if (this.providers.has(providerType)) {
      return this.providers.get(providerType);
    }
    // 回退：类型别名匹配（DB 同步的 Provider，如 'ollama' → 'db:uuid'）
    const aliasedId = this.providerTypeToId.get(providerType);
    if (aliasedId && this.providers.has(aliasedId)) {
      return this.providers.get(aliasedId);
    }
    return undefined;
  }

  /**
   * 根据模型名解析对应 Provider 类型
   * 数据来源：model_registry 表，精确匹配。
   */
  resolveModelToProviderId(model: string): string | undefined {
    return this.modelToProviderType.get(model.toLowerCase());
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
   * 反向查找：根据 registryId（如 db:uuid）获取 providerType（如 'openai'）
   * 用于 ImageGenerateTool 等需要知道 Provider 类型的场景
   */
  getProviderTypeById(registryId: string): string | undefined {
    for (const [type, id] of this.providerTypeToId) {
      if (id === registryId) return type;
    }
    // 回退：直接 ID 匹配（如 'openai'、'stability' 等硬编码注册的 Provider）
    if (this.providers.has(registryId)) return registryId;
    return undefined;
  }

  /**
   * 获取或创建 Provider — 吸收旧 LLMClientFactory 的 createClient 逻辑
   */
  getOrCreate(providerId: string, config?: ProviderConfig): AIProvider {
    if (this.has(providerId)) {
      return this.get(providerId);
    }
    const { createProviderByType } = require('./ProviderFactory');
    const provider = createProviderByType(providerId, config || {});
    this.register(provider);
    return provider;
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
    this.modelToProviderType.clear();
    logger.info('All providers cleared');
  }

  /**
   * 设置模型→Provider 类型映射（数据来源：model_registry 表）
   * 在 syncDBProvidersToRegistry 时调用，从 DB 同步。
   */
  setModelMappings(mappings: Map<string, string>): void {
    this.modelToProviderType = mappings;
    logger.debug(`模型→Provider 映射已更新: ${mappings.size} 条`);
  }

  get size(): number {
    return this.providers.size;
  }
}

export const providerRegistry = new ProviderRegistry();
