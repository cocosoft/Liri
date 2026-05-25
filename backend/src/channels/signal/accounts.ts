/**
 * Signal 账户管理模块
 * 对标 IRC accounts.ts 模式
 */

export interface SignalAccount {
  phoneNumber: string;
  signalServiceUrl: string;
  registrationLockPin?: string;
  label?: string;
}

export interface ResolvedSignalAccount extends SignalAccount {
  resolved: boolean;
}

const accountStore = new Map<string, SignalAccount>();

export function registerSignalAccount(
  id: string,
  account: SignalAccount
): void {
  accountStore.set(id, { ...account });
}

export function getSignalAccount(id: string): SignalAccount | undefined {
  return accountStore.get(id);
}

export function resolveSignalAccount(id: string): ResolvedSignalAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return { ...account, resolved: true };
}

export function listSignalAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeSignalAccount(id: string): boolean {
  return accountStore.delete(id);
}
