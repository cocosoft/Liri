/**
 * 微信公众号账户管理模块
 * 对标 IRC accounts.ts 模式
 */

export interface WechatAccount {
  appId: string;
  appSecret: string;
  token: string;
  encodingAESKey?: string;
  label?: string;
}

export interface ResolvedWechatAccount extends WechatAccount {
  resolved: boolean;
}

const accountStore = new Map<string, WechatAccount>();

export function registerWechatAccount(
  id: string,
  account: WechatAccount
): void {
  accountStore.set(id, { ...account });
}

export function getWechatAccount(id: string): WechatAccount | undefined {
  return accountStore.get(id);
}

export function resolveWechatAccount(id: string): ResolvedWechatAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return { ...account, resolved: true };
}

export function listWechatAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeWechatAccount(id: string): boolean {
  return accountStore.delete(id);
}
