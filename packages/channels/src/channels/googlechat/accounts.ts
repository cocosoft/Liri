/**
 * Google Chat 账户管理模块
 * 对标 OpenClaw extensions/googlechat/src/accounts.ts
 */

export interface GoogleChatAccount {
  serviceAccountEmail: string;
  serviceAccountKey: string;
  scope?: string;
  tokenUrl?: string;
}

export interface ResolvedGoogleChatAccount extends GoogleChatAccount {
  resolved: boolean;
}

const accountStore = new Map<string, GoogleChatAccount>();

export function registerGoogleChatAccount(
  id: string,
  account: GoogleChatAccount
): void {
  accountStore.set(id, { ...account });
}

export function getGoogleChatAccount(
  id: string
): GoogleChatAccount | undefined {
  return accountStore.get(id);
}

export function resolveGoogleChatAccount(
  id: string
): ResolvedGoogleChatAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return { ...account, resolved: true };
}

export function listGoogleChatAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeGoogleChatAccount(id: string): boolean {
  return accountStore.delete(id);
}
