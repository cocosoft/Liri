/**
 * Slack 账户管理模块
 * 对标 IRC accounts.ts 模式
 */

export interface SlackAccount {
  botToken: string;
  appToken?: string;
  signingSecret: string;
  channels: string[];
  label?: string;
}

export interface ResolvedSlackAccount extends SlackAccount {
  resolved: boolean;
}

const accountStore = new Map<string, SlackAccount>();

export function registerSlackAccount(id: string, account: SlackAccount): void {
  accountStore.set(id, { ...account });
}

export function getSlackAccount(id: string): SlackAccount | undefined {
  return accountStore.get(id);
}

export function resolveSlackAccount(id: string): ResolvedSlackAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return { ...account, resolved: true };
}

export function listSlackAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeSlackAccount(id: string): boolean {
  return accountStore.delete(id);
}
