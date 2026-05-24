import type { IContextEngine } from './IContextEngine';

/**
 * 压缩特征
 * 用于 ContextEngineRegistry.select() 的自动引擎选择
 */
export interface CompressionFeature {
  conversationLength: number;
  tokenUsage: number;
  focusTopic?: string;
  hasTools: boolean;
}

/**
 * 上下文引擎注册中心
 * 对标 Hermes 的可插拔 ContextEngine 体系
 * 支持按特征自动选择最优引擎
 */
export class ContextEngineRegistry {
  private engines: Map<string, IContextEngine> = new Map();

  register(name: string, engine: IContextEngine): void {
    this.engines.set(name, engine);
  }

  unregister(name: string): boolean {
    return this.engines.delete(name);
  }

  get(name: string): IContextEngine | undefined {
    return this.engines.get(name);
  }

  getAll(): IContextEngine[] {
    return Array.from(this.engines.values());
  }

  getNames(): string[] {
    return Array.from(this.engines.keys());
  }

  /**
   * 基于压缩特征自动选择最优引擎
   * @param feature 当前上下文特征
   * @returns 匹配的引擎，无可匹配则返回 undefined
   */
  select(feature: CompressionFeature): IContextEngine | undefined {
    if (this.engines.size === 0) return undefined;

    if (this.engines.size === 1) {
      const only = this.engines.values().next().value;
      return only;
    }

    const hybrid = this.engines.get('hybrid');
    const summarizer = this.engines.get('summarizer');
    const truncator = this.engines.get('truncator');

    if (hybrid && feature.conversationLength > 50 && feature.hasTools) {
      return hybrid;
    }

    if (truncator && feature.tokenUsage > 0.9) {
      return truncator;
    }

    if (summarizer && feature.focusTopic && feature.conversationLength > 10) {
      return summarizer;
    }

    return summarizer || truncator || hybrid;
  }

  clear(): void {
    this.engines.clear();
  }

  get size(): number {
    return this.engines.size;
  }

  has(name: string): boolean {
    return this.engines.has(name);
  }
}
