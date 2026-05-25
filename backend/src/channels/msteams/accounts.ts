/**
 * Microsoft Teams 账户管理模块
 * 对标 OpenClaw extensions/msteams/src/accounts.ts
 */

export interface MSTeamsAccount {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  botEndpoint?: string;
}

export interface ResolvedMSTeamsAccount extends MSTeamsAccount {
  resolved: boolean;
}

const accountStore = new Map<string, MSTeamsAccount>();

export function registerMSTeamsAccount(id: string, account: MSTeamsAccount): void {
  accountStore.set(id, { ...account });
}

export function getMSTeamsAccount(id: string): MSTeamsAccount | undefined {
  return accountStore.get(id);
}

export function resolveMSTeamsAccount(id: string): ResolvedMSTeamsAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return { ...account, resolved: true };
}

export function listMSTeamsAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeMSTeamsAccount(id: string): boolean {
  return accountStore.delete(id);
}
