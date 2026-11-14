/**
 * 邮件账户管理模块
 * 对标 OpenClaw extensions/irc/src/accounts.ts
 */

export interface EmailAccount {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromAddress: string;
  fromName?: string;
}

export interface ResolvedEmailAccount extends EmailAccount {
  fromName: string;
  resolved: boolean;
}

const accountStore = new Map<string, EmailAccount>();

export function registerEmailAccount(id: string, account: EmailAccount): void {
  accountStore.set(id, { ...account });
}

export function getEmailAccount(id: string): EmailAccount | undefined {
  return accountStore.get(id);
}

export function resolveEmailAccount(id: string): ResolvedEmailAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return {
    ...account,
    fromName: account.fromName || account.user.split('@')[0] || 'Liri',
    resolved: true,
  };
}

export function listEmailAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeEmailAccount(id: string): boolean {
  return accountStore.delete(id);
}
