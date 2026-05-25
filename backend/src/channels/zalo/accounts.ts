/**
 * Zalo 账户管理模块
 * 对标 IRC accounts.ts 模式
 */

export interface ZaloAccount {
  appId: string;
  secretKey: string;
  accessToken: string;
  label?: string;
}

export interface ResolvedZaloAccount extends ZaloAccount {
  resolved: boolean;
}

const accountStore = new Map<string, ZaloAccount>();

export function registerZaloAccount(id: string, account: ZaloAccount): void {
  accountStore.set(id, { ...account });
}

export function getZaloAccount(id: string): ZaloAccount | undefined {
  return accountStore.get(id);
}

export function resolveZaloAccount(id: string): ResolvedZaloAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return { ...account, resolved: true };
}

export function listZaloAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeZaloAccount(id: string): boolean {
  return accountStore.delete(id);
}
