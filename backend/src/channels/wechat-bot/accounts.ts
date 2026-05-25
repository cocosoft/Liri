/**
 * 微信机器人账户管理模块
 * 对标 IRC accounts.ts 模式
 */

export interface WechatBotAccount {
  mode: 'ilink' | 'wcf';
  ilinkHost?: string;
  ilinkPort?: number;
  wcfHost?: string;
  wcfPort?: number;
  autoReconnect: boolean;
  label?: string;
}

export interface ResolvedWechatBotAccount extends WechatBotAccount {
  resolved: boolean;
}

const accountStore = new Map<string, WechatBotAccount>();

export function registerWechatBotAccount(
  id: string,
  account: WechatBotAccount
): void {
  accountStore.set(id, { ...account });
}

export function getWechatBotAccount(id: string): WechatBotAccount | undefined {
  return accountStore.get(id);
}

export function resolveWechatBotAccount(
  id: string
): ResolvedWechatBotAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return { ...account, resolved: true };
}

export function listWechatBotAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeWechatBotAccount(id: string): boolean {
  return accountStore.delete(id);
}
