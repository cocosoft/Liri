/**
 * Nostr 账户管理模块
 * 对标 IRC accounts.ts 模式
 */

export interface NostrAccount {
  publicKey: string;
  privateKey?: string;
  relays: string[];
  label?: string;
}

export interface ResolvedNostrAccount extends NostrAccount {
  resolved: boolean;
}

const accountStore = new Map<string, NostrAccount>();

export function registerNostrAccount(id: string, account: NostrAccount): void {
  accountStore.set(id, { ...account });
}

export function getNostrAccount(id: string): NostrAccount | undefined {
  return accountStore.get(id);
}

export function resolveNostrAccount(id: string): ResolvedNostrAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return { ...account, resolved: true };
}

export function listNostrAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeNostrAccount(id: string): boolean {
  return accountStore.delete(id);
}
