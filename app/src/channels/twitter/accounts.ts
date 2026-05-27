/**
 * Twitter/X 账户管理模块
 * 对标 IRC accounts.ts 模式
 */

export interface TwitterAccount {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
  label?: string;
}

export interface ResolvedTwitterAccount extends TwitterAccount {
  resolved: boolean;
}

const accountStore = new Map<string, TwitterAccount>();

export function registerTwitterAccount(
  id: string,
  account: TwitterAccount
): void {
  accountStore.set(id, { ...account });
}

export function getTwitterAccount(id: string): TwitterAccount | undefined {
  return accountStore.get(id);
}

export function resolveTwitterAccount(
  id: string
): ResolvedTwitterAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return { ...account, resolved: true };
}

export function listTwitterAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeTwitterAccount(id: string): boolean {
  return accountStore.delete(id);
}
