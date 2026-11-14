/**
 * 企业微信账户管理模块
 * 对标 IRC accounts.ts 模式
 */

export interface WeComAccount {
  corpId: string;
  agentId: string;
  corpSecret: string;
  token: string;
  encodingAESKey?: string;
  label?: string;
}

export interface ResolvedWeComAccount extends WeComAccount {
  resolved: boolean;
}

const accountStore = new Map<string, WeComAccount>();

export function registerWeComAccount(id: string, account: WeComAccount): void {
  accountStore.set(id, { ...account });
}

export function getWeComAccount(id: string): WeComAccount | undefined {
  return accountStore.get(id);
}

export function resolveWeComAccount(id: string): ResolvedWeComAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return { ...account, resolved: true };
}

export function listWeComAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeWeComAccount(id: string): boolean {
  return accountStore.delete(id);
}
