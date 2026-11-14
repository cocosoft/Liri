/**
 * SMS 账户管理模块
 * 对标 IRC accounts.ts 模式
 */

export interface SmsAccount {
  provider: string;
  apiKey: string;
  fromNumber: string;
  region?: string;
  label?: string;
}

export interface ResolvedSmsAccount extends SmsAccount {
  resolved: boolean;
}

const accountStore = new Map<string, SmsAccount>();

export function registerSmsAccount(id: string, account: SmsAccount): void {
  accountStore.set(id, { ...account });
}

export function getSmsAccount(id: string): SmsAccount | undefined {
  return accountStore.get(id);
}

export function resolveSmsAccount(id: string): ResolvedSmsAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return { ...account, resolved: true };
}

export function listSmsAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeSmsAccount(id: string): boolean {
  return accountStore.delete(id);
}
