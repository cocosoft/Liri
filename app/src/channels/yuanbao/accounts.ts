/**
 * 元宝账户管理模块
 * 对标 IRC accounts.ts 模式
 */

export interface YuanbaoAccount {
  apiKey: string;
  apiUrl: string;
  label?: string;
}

export interface ResolvedYuanbaoAccount extends YuanbaoAccount {
  resolved: boolean;
}

const accountStore = new Map<string, YuanbaoAccount>();

export function registerYuanbaoAccount(
  id: string,
  account: YuanbaoAccount
): void {
  accountStore.set(id, { ...account });
}

export function getYuanbaoAccount(id: string): YuanbaoAccount | undefined {
  return accountStore.get(id);
}

export function resolveYuanbaoAccount(
  id: string
): ResolvedYuanbaoAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return { ...account, resolved: true };
}

export function listYuanbaoAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeYuanbaoAccount(id: string): boolean {
  return accountStore.delete(id);
}
