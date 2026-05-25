/**
 * Webhook 账户管理模块
 * 对标 IRC accounts.ts 模式
 */

export interface WebhookAccount {
  port: number;
  path: string;
  secret: string;
  label?: string;
}

export interface ResolvedWebhookAccount extends WebhookAccount {
  resolved: boolean;
}

const accountStore = new Map<string, WebhookAccount>();

export function registerWebhookAccount(
  id: string,
  account: WebhookAccount
): void {
  accountStore.set(id, { ...account });
}

export function getWebhookAccount(id: string): WebhookAccount | undefined {
  return accountStore.get(id);
}

export function resolveWebhookAccount(
  id: string
): ResolvedWebhookAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return { ...account, resolved: true };
}

export function listWebhookAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeWebhookAccount(id: string): boolean {
  return accountStore.delete(id);
}
