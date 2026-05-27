/**
 * 钉钉账户管理模块
 * 对标 IRC accounts.ts 模式
 */

export interface DingTalkAccount {
  appKey: string;
  appSecret: string;
  agentId?: string;
  webhookUrl?: string;
  label?: string;
}

export interface ResolvedDingTalkAccount extends DingTalkAccount {
  resolved: boolean;
}

const accountStore = new Map<string, DingTalkAccount>();

export function registerDingTalkAccount(
  id: string,
  account: DingTalkAccount
): void {
  accountStore.set(id, { ...account });
}

export function getDingTalkAccount(id: string): DingTalkAccount | undefined {
  return accountStore.get(id);
}

export function resolveDingTalkAccount(
  id: string
): ResolvedDingTalkAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;

  return {
    ...account,
    resolved: true,
  };
}

export function listDingTalkAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeDingTalkAccount(id: string): boolean {
  return accountStore.delete(id);
}
