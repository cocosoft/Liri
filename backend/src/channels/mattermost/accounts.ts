/**
 * Mattermost 账户管理模块
 * 对齐其他通道 accounts.ts 模式
 */

import type { MattermostConfig } from './config-schema';

export interface MattermostAccount {
  serverUrl: string;
  botToken: string;
  botUsername?: string;
  homeChannel?: string;
  label?: string;
}

export interface ResolvedMattermostAccount extends MattermostAccount {
  resolved: boolean;
}

const accountStore = new Map<string, MattermostAccount>();

export function registerMattermostAccount(
  id: string,
  account: MattermostAccount
): void {
  accountStore.set(id, { ...account });
}

export function getMattermostAccount(
  id: string
): MattermostAccount | undefined {
  return accountStore.get(id);
}

export function resolveMattermostAccount(
  id: string
): ResolvedMattermostAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return { ...account, resolved: true };
}

export function listMattermostAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeMattermostAccount(id: string): boolean {
  return accountStore.delete(id);
}
