/**
 * Discord 账户管理模块
 * 对标 OpenClaw extensions/discord/src/accounts.ts
 */

export interface DiscordAccount {
  botToken: string;
  intents?: number;
  gatewayUrl?: string;
  restBaseUrl?: string;
}

export interface ResolvedDiscordAccount extends DiscordAccount {
  resolved: boolean;
  botId?: string;
}

const accountStore = new Map<string, DiscordAccount>();

export function registerDiscordAccount(
  id: string,
  account: DiscordAccount
): void {
  accountStore.set(id, { ...account });
}

export function getDiscordAccount(id: string): DiscordAccount | undefined {
  return accountStore.get(id);
}

export function resolveDiscordAccount(
  id: string
): ResolvedDiscordAccount | null {
  const account = accountStore.get(id);
  if (!account) return null;
  const botIdMatch = account.botToken.match(/^([^.]+)\./);
  return {
    ...account,
    resolved: true,
    botId: botIdMatch ? botIdMatch[1] : undefined,
  };
}

export function listDiscordAccountIds(): string[] {
  return Array.from(accountStore.keys());
}

export function removeDiscordAccount(id: string): boolean {
  return accountStore.delete(id);
}
