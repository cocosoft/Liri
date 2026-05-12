/**
 * HookChainManager — 多域 HookChain 管理器
 *
 * 统一管理多个领域的 HookChain 实例：
 *   - chat   — 聊天消息/工具调用 Hook
 *   - plugin — 插件生命周期 Hook
 *   - tool   — 工具执行 Hook
 *   - system — 系统事件 Hook
 *
 * 作为旧 HookManager / ChatHookExecutor 的替代入口。
 * 用法:
 * ```
 * const mgr = HookChainManager.getInstance();
 * mgr.domain('chat').before('validate', async (ctx) => { ... });
 * const result = await mgr.execute('chat', { event: 'preMessage', ... });
 * ```
 */

import { HookChain, HookContext, HookResult } from './HookChain';

/**
 * 多域 HookChain 管理器
 */
export class HookChainManager {
  private static instance: HookChainManager;
  private domains: Map<string, HookChain> = new Map();

  private constructor() {}

  static getInstance(): HookChainManager {
    if (!HookChainManager.instance) {
      HookChainManager.instance = new HookChainManager();
    }
    return HookChainManager.instance;
  }

  /**
   * 获取或创建指定域的 HookChain
   */
  domain(name: string): HookChain {
    let chain = this.domains.get(name);
    if (!chain) {
      chain = new HookChain(name);
      this.domains.set(name, chain);
    }
    return chain;
  }

  /**
   * 在指定域上执行 Hook 链
   */
  async execute(
    domain: string,
    context: HookContext
  ): Promise<{ before: HookResult[]; after: HookResult[]; error?: Error }> {
    const chain = this.domains.get(domain);
    if (!chain) {
      return { before: [], after: [] };
    }
    return chain.execute(context);
  }

  /**
   * 清空指定域的所有 hooks
   */
  clear(domain: string): void {
    const chain = this.domains.get(domain);
    if (chain) chain.clear();
  }

  /**
   * 清空所有域的 hooks
   */
  clearAll(): void {
    this.domains.clear();
  }

  /**
   * 获取所有域的状态
   */
  stats(): Record<string, { before: number; after: number; onError: number }> {
    const result: Record<
      string,
      { before: number; after: number; onError: number }
    > = {};
    for (const [name, chain] of this.domains) {
      result[name] = chain.stats();
    }
    return result;
  }

  /**
   * 判断指定域是否有已注册的 hook
   */
  hasDomain(domain: string): boolean {
    return this.domains.has(domain);
  }

  /**
   * 获取所有已注册的域名
   */
  getDomains(): string[] {
    return Array.from(this.domains.keys());
  }

  /**
   * 获取所有域的所有 hook 条目
   */
  getAllEntries(): Array<{
    name: string;
    stage: 'before' | 'after' | 'onError';
    priority: number;
    enabled: boolean;
    event: string;
    domain: string;
  }> {
    const all: Array<{
      name: string;
      stage: 'before' | 'after' | 'onError';
      priority: number;
      enabled: boolean;
      event: string;
      domain: string;
    }> = [];

    for (const [domainName, chain] of this.domains) {
      const entries = chain.getEntries();
      for (const entry of entries) {
        all.push({ ...entry, domain: domainName });
      }
    }

    return all;
  }
}
