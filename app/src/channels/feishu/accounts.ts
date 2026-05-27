/**
 * 飞书账户管理模块
 * 对标 OpenClaw extensions/feishu/src/accounts.ts
 */

export interface FeishuAccount {
  appId: string;
  appSecret: string;
  verifyToken?: string;
}

export interface ResolvedFeishuAccount extends FeishuAccount {
  resolved: boolean;
  domain?: 'feishu' | 'lark';
}

const accountStore = new Map<string, FeishuAccount>();

export function registerFeishuAccount(
  id: string,
  account: FeishuAccount
): void {
  accountStore.set(id, { ...account });
}

export function getFeishuAccount(id: string): FeishuAccount | undefined {
  return accountStore.get(id);
}

export function resolveFeishuAccount(id: string): ResolvedFeishuAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return { ...account, resolved: true, domain: 'feishu' };
}

export function listFeishuAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeFeishuAccount(id: string): boolean {
  return accountStore.delete(id);
}
