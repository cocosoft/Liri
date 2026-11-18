/**
 * LINE 账户管理模块
 * 对标 OpenClaw extensions/line/src/accounts.ts
 */

export interface LineAccount {
  channelSecret: string;
  channelAccessToken: string;
  apiBase?: string;
}

export interface ResolvedLineAccount extends LineAccount {
  resolved: boolean;
}

const accountStore = new Map<string, LineAccount>();

export function registerLineAccount(id: string, account: LineAccount): void {
  accountStore.set(id, { ...account });
}

export function getLineAccount(id: string): LineAccount | undefined {
  return accountStore.get(id);
}

export function resolveLineAccount(id: string): ResolvedLineAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return { ...account, resolved: true };
}

export function listLineAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeLineAccount(id: string): boolean {
  return accountStore.delete(id);
}
