/**
 * Facebook Messenger 账户管理模块
 * 对标 IRC accounts.ts 模式
 */

export interface FacebookMessengerAccount {
  pageAccessToken: string;
  verifyToken: string;
  appSecret: string;
  pageId: string;
  label?: string;
}

export interface ResolvedFacebookMessengerAccount extends FacebookMessengerAccount {
  resolved: boolean;
}

const accountStore = new Map<string, FacebookMessengerAccount>();

export function registerFacebookMessengerAccount(
  id: string,
  account: FacebookMessengerAccount
): void {
  accountStore.set(id, { ...account });
}

export function getFacebookMessengerAccount(
  id: string
): FacebookMessengerAccount | undefined {
  return accountStore.get(id);
}

export function resolveFacebookMessengerAccount(
  id: string
): ResolvedFacebookMessengerAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;

  return {
    ...account,
    resolved: true,
  };
}

export function listFacebookMessengerAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeFacebookMessengerAccount(id: string): boolean {
  return accountStore.delete(id);
}
