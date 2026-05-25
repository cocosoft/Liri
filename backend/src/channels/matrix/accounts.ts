/**
 * Matrix 账户管理模块
 * 对标 OpenClaw extensions/matrix/src/accounts.ts
 */

export interface MatrixAccount {
  userId: string;
  accessToken: string;
  deviceId?: string;
  homeserverUrl: string;
}

export interface ResolvedMatrixAccount extends MatrixAccount {
  resolved: boolean;
}

const accountStore = new Map<string, MatrixAccount>();

export function registerMatrixAccount(id: string, account: MatrixAccount): void {
  accountStore.set(id, { ...account });
}

export function getMatrixAccount(id: string): MatrixAccount | undefined {
  return accountStore.get(id);
}

export function resolveMatrixAccount(id: string): ResolvedMatrixAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  return { ...account, resolved: true };
}

export function listMatrixAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeMatrixAccount(id: string): boolean {
  return accountStore.delete(id);
}
