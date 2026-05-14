/**
 * ProviderCatalog 提供者目录
 * 管理和发现 AI 提供者及其模型能力
 */

/**
 * 提供者类型
 */
export type ProviderType = 'llm' | 'embedding' | 'image' | 'audio' | 'tools' | 'storage';

/**
 * 提供者能力
 */
export interface ProviderCapability {
  type: ProviderType;
  models: string[];
  maxTokens?: number;
  supportsStreaming?: boolean;
  supportsFunctions?: boolean;
  supportsVision?: boolean;
}

/**
 * 提供者认证方式
 */
export type ProviderAuthMethod = 'api-key' | 'oauth' | 'basic' | 'bearer' | 'custom';

/**
 * 提供者元数据
 */
export interface ProviderMetadata {
  id: string;
  name: string;
  description: string;
  version: string;
  type: ProviderType;
  capabilities: ProviderCapability[];
  authMethods: ProviderAuthMethod[];
  baseUrl: string;
  docsUrl?: string;
  status: 'active' | 'deprecated' | 'beta';
  priority: number;
  rateLimit?: {
    requestsPerMinute: number;
    tokensPerMinute?: number;
  };
}

/**
 * 提供者目录
 * 对标 OpenClaw provider-catalog
 */
export class ProviderCatalog {
  private providers: Map<string, ProviderMetadata> = new Map();

  /**
   * 注册提供者
   */
  register(provider: ProviderMetadata): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * 批量注册提供者
   */
  registerMany(providers: ProviderMetadata[]): void {
    for (const provider of providers) {
      this.providers.set(provider.id, provider);
    }
  }

  /**
   * 获取提供者
   */
  get(providerId: string): ProviderMetadata | undefined {
    return this.providers.get(providerId);
  }

  /**
   * 按类型获取提供者
   */
  getByType(type: ProviderType): ProviderMetadata[] {
    return Array.from(this.providers.values()).filter((p) => p.type === type);
  }

  /**
   * 获取所有提供者
   */
  getAll(): ProviderMetadata[] {
    return Array.from(this.providers.values());
  }

  /**
   * 搜索提供者
   */
  search(query: string): ProviderMetadata[] {
    const q = query.toLowerCase();
    return Array.from(this.providers.values()).filter(
      (p) =>
        p.id.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
    );
  }

  /**
   * 获取指定模型的提供者
   */
  findByModel(model: string): ProviderMetadata[] {
    return Array.from(this.providers.values()).filter((p) =>
      p.capabilities.some((c) => c.models.includes(model))
    );
  }

  /**
   * 获取活跃提供者
   */
  getActive(): ProviderMetadata[] {
    return Array.from(this.providers.values()).filter((p) => p.status === 'active');
  }

  /**
   * 注销提供者
   */
  unregister(providerId: string): boolean {
    return this.providers.delete(providerId);
  }

  /**
   * 获取提供者数量
   */
  count(): number {
    return this.providers.size;
  }
}

export const providerCatalog = new ProviderCatalog();
