/**
 * Telegram 账户管理模块
 * 对标 IRC accounts.ts 模式
 */

export interface TelegramAccount {
  botToken: string;
  webhookUrl?: string;
  label?: string;
}

export interface ResolvedTelegramAccount extends TelegramAccount {
  resolved: boolean;
}

const accountStore = new Map<string, TelegramAccount>();

export function registerTelegramAccount(
  id: string,
  account: TelegramAccount
): void {
  accountStore.set(id, { ...account });
}

export function getTelegramAccount(id: string): TelegramAccount | undefined {
  return accountStore.get(id);
}

export function resolveTelegramAccount(
  id: string
): ResolvedTelegramAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return { ...account, resolved: true };
}

export function listTelegramAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeTelegramAccount(id: string): boolean {
  return accountStore.delete(id);
}
