/**
 * IRC 账户管理模块
 * 对标 OpenClaw extensions/irc/src/accounts.ts
 */

export interface IrcAccount {
  nickname: string;
  username?: string;
  realname?: string;
  password?: string;
  nickservPassword?: string;
}

export interface ResolvedIrcAccount extends IrcAccount {
  username: string;
  realname: string;
  resolved: boolean;
}

const accountStore = new Map<string, IrcAccount>();

export function registerIrcAccount(id: string, account: IrcAccount): void {
  accountStore.set(id, { ...account });
}

export function getIrcAccount(id: string): IrcAccount | undefined {
  return accountStore.get(id);
}

export function resolveIrcAccount(id: string): ResolvedIrcAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return {
    ...account,
    username: account.username || account.nickname,
    realname: account.realname || account.nickname,
    resolved: true,
  };
}

export function listIrcAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeIrcAccount(id: string): boolean {
  return accountStore.delete(id);
}
