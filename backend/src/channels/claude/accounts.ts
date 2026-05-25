/**
 * Claude 账户管理模块
 * 对标 IRC accounts.ts 模式
 */

export interface ClaudeAccount {
  apiKey: string;
  model: string;
  maxTokens: number;
  label?: string;
}

export interface ResolvedClaudeAccount extends ClaudeAccount {
  resolved: boolean;
}

const accountStore = new Map<string, ClaudeAccount>();

export function registerClaudeAccount(
  id: string,
  account: ClaudeAccount
): void {
  accountStore.set(id, { ...account });
}

export function getClaudeAccount(id: string): ClaudeAccount | undefined {
  return accountStore.get(id);
}

export function resolveClaudeAccount(id: string): ResolvedClaudeAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return { ...account, resolved: true };
}

export function listClaudeAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeClaudeAccount(id: string): boolean {
  return accountStore.delete(id);
}
