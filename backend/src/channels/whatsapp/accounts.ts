/**
 * WhatsApp 账户管理模块
 * 对标 IRC accounts.ts 模式
 */

export interface WhatsAppAccount {
  phoneNumberId: string;
  accessToken: string;
  webhookVerifyToken: string;
  apiVersion: string;
  label?: string;
}

export interface ResolvedWhatsAppAccount extends WhatsAppAccount {
  resolved: boolean;
}

const accountStore = new Map<string, WhatsAppAccount>();

export function registerWhatsAppAccount(
  id: string,
  account: WhatsAppAccount
): void {
  accountStore.set(id, { ...account });
}

export function getWhatsAppAccount(id: string): WhatsAppAccount | undefined {
  return accountStore.get(id);
}

export function resolveWhatsAppAccount(
  id: string
): ResolvedWhatsAppAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return { ...account, resolved: true };
}

export function listWhatsAppAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeWhatsAppAccount(id: string): boolean {
  return accountStore.delete(id);
}
