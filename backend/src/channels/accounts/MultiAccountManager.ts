import type {
  NamedAccount,
  ResolvedAccount,
  AccountRegistrationOptions,
} from './types';

/**
 * MultiAccountManager — 多账号管理器
 *
 * 提供账号注册、解析、默认回退功能。
 * 对齐 OpenClaw resolveAccountWithDefaultFallback + accounts.ts 体系。
 * 每条通道可持有自己的 MultiAccountManager 实例，实现通道级多账号管理。
 */
export class MultiAccountManager {
  private accounts = new Map<string, NamedAccount>();
  private defaultAccountId: string | null = null;

  /**
   * 注册一个账号
   * 如果 isDefault 为 true 且无其他默认账号，自动设为默认。
   */
  register(options: AccountRegistrationOptions): void {
    const account: NamedAccount = {
      id: options.id,
      displayName: options.displayName || options.id,
      config: options.config || {},
      isDefault: options.isDefault || false,
    };
    this.accounts.set(options.id, account);

    if (account.isDefault && !this.defaultAccountId) {
      this.defaultAccountId = options.id;
    }
  }

  /** 批量注册账号 */
  registerMany(optionsList: AccountRegistrationOptions[]): void {
    for (const opts of optionsList) {
      this.register(opts);
    }
  }

  /** 设置默认账号 */
  setDefault(id: string): boolean {
    if (!this.accounts.has(id)) return false;
    this.defaultAccountId = id;
    return true;
  }

  /** 获取默认账号 ID */
  getDefaultId(): string | null {
    return this.defaultAccountId;
  }

  /** 按 ID 获取账号 */
  get(id: string): NamedAccount | undefined {
    return this.accounts.get(id);
  }

  /** 列出所有注册的账号 ID */
  listIds(): string[] {
    return Array.from(this.accounts.keys());
  }

  /** 列出所有账号 */
  listAll(): NamedAccount[] {
    return Array.from(this.accounts.values());
  }

  /** 列出所有启用的账号 */
  listEnabled(): NamedAccount[] {
    return this.listAll().filter((a) => a.config?.enabled !== false);
  }

  /** 移除账号 */
  remove(id: string): boolean {
    const removed = this.accounts.delete(id);
    if (removed && this.defaultAccountId === id) {
      this.defaultAccountId =
        this.accounts.size > 0
          ? (this.accounts.keys().next().value as string)
          : null;
    }
    return removed;
  }

  /** 清空所有账号 */
  clear(): void {
    this.accounts.clear();
    this.defaultAccountId = null;
  }

  /**
   * 解析账号：按指定 ID 查找，未命中时 fallback 到默认账号
   * 对齐 OpenClaw resolveAccountWithDefaultFallback
   */
  resolve(accountId?: string | null): ResolvedAccount | null {
    const id = accountId?.trim() || this.defaultAccountId;
    if (!id) return null;

    // 精确匹配
    const exact = this.accounts.get(id);
    if (exact) {
      return { account: exact, fallback: false };
    }

    // Fallback 到默认账号
    if (this.defaultAccountId && this.defaultAccountId !== id) {
      const fallback = this.accounts.get(this.defaultAccountId);
      if (fallback) {
        return { account: fallback, fallback: true };
      }
    }

    // 任意可用账号
    const first = this.accounts.values().next().value;
    if (first) {
      return { account: first, fallback: true };
    }

    return null;
  }

  /** 账号数量 */
  get size(): number {
    return this.accounts.size;
  }
}
