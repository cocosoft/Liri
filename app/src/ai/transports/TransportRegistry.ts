/**
 * 传输注册表
 * 对标 Hermes agent/transports/__init__.py 的注册机制
 * 按提供商名称注册传输实现，支持按模型名自动匹配
 */
import type { BaseTransport } from './BaseTransport';

export class TransportRegistry {
  private transports: Map<string, BaseTransport> = new Map();
  private modelToProvider: Map<string, string> = new Map();

  /**
   * 注册传输实现
   * @param transport 传输实现
   */
  register(transport: BaseTransport): void {
    this.transports.set(transport.provider, transport);

    for (const model of transport.supportedModels) {
      this.modelToProvider.set(model, transport.provider);
    }
  }

  /**
   * 注销传输
   * @param provider 提供商标识
   * @returns 是否成功
   */
  unregister(provider: string): boolean {
    const transport = this.transports.get(provider);
    if (!transport) {
      return false;
    }

    this.transports.delete(provider);

    for (const [model, p] of this.modelToProvider) {
      if (p === provider) {
        this.modelToProvider.delete(model);
      }
    }

    return true;
  }

  /**
   * 按提供商标识获取传输
   * @param provider 提供商标识
   * @returns 对应传输实现
   */
  getByProvider(provider: string): BaseTransport | undefined {
    return this.transports.get(provider);
  }

  /**
   * 按模型名自动匹配传输
   * 优先精确匹配，降级为前缀匹配
   * @param model 模型名称
   * @returns 匹配的传输实现
   */
  getByModel(model: string): BaseTransport | undefined {
    const normalized = model.toLowerCase();

    const provider = this.modelToProvider.get(normalized);
    if (provider) {
      return this.transports.get(provider);
    }

    for (const [registeredModel, p] of this.modelToProvider) {
      if (
        normalized.startsWith(registeredModel) ||
        registeredModel.startsWith(normalized)
      ) {
        return this.transports.get(p);
      }
    }

    return undefined;
  }

  /**
   * 列出所有已注册的提供商标识
   * @returns 提供商标识列表
   */
  listProviders(): string[] {
    return Array.from(this.transports.keys());
  }

  /**
   * 获取已注册传输数量
   */
  get size(): number {
    return this.transports.size;
  }

  /**
   * 检查提供商是否已注册
   * @param provider 提供商标识
   */
  has(provider: string): boolean {
    return this.transports.has(provider);
  }
}

export const transportRegistry = new TransportRegistry();
