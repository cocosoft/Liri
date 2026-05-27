/**
 * QQ Bot 账户管理模块
 * 对标 IRC accounts.ts 模式
 */

export interface QQAccount {
  appId: string;
  clientSecret: string;
  token: string;
  label?: string;
}

export interface ResolvedQQAccount extends QQAccount {
  resolved: boolean;
}

const accountStore = new Map<string, QQAccount>();

export function registerQQAccount(id: string, account: QQAccount): void {
  accountStore.set(id, { ...account });
}

export function getQQAccount(id: string): QQAccount | undefined {
  return accountStore.get(id);
}

export function resolveQQAccount(id: string): ResolvedQQAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return { ...account, resolved: true };
}

export function listQQAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeQQAccount(id: string): boolean {
  return accountStore.delete(id);
}
