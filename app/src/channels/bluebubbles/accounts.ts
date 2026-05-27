/**
 * BlueBubbles 账户管理模块
 */

import type { BlueBubblesConfig } from './config-schema';

export interface BlueBubblesAccount {
  serverUrl: string;
  password: string;
  homeHandle?: string;
  label?: string;
}

export interface ResolvedBlueBubblesAccount extends BlueBubblesAccount {
  resolved: boolean;
}

const accountStore = new Map<string, BlueBubblesAccount>();

export function registerBlueBubblesAccount(
  id: string,
  account: BlueBubblesAccount
): void {
  accountStore.set(id, { ...account });
}

export function getBlueBubblesAccount(
  id: string
): BlueBubblesAccount | undefined {
  return accountStore.get(id);
}

export function resolveBlueBubblesAccount(
  id: string
): ResolvedBlueBubblesAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return { ...account, resolved: true };
}

export function listBlueBubblesAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeBlueBubblesAccount(id: string): boolean {
  return accountStore.delete(id);
}
