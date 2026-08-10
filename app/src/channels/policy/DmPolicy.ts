/**
 * DM Policy 引擎
 * pairing / allowlist / open 三档安全策略
 * 对齐 OpenClaw channels/dm-policy-shared.ts
 */

import { getLogger } from '@modules/monitoring';
import type {
  DmPolicy,
  MessageContext,
  ResolvedSender,
} from '@modules/channels/types';
import { PairingStore } from './PairingStore';

const logger = getLogger('channels:dm');

export interface DmPolicyConfig {
  policy: DmPolicy;
  allowFrom: string[];
  pairingCodeTimeoutMs: number;
  maxPairingAttempts: number;
}

const DEFAULT_POLICY_CONFIG: DmPolicyConfig = {
  policy: 'pairing',
  allowFrom: [],
  pairingCodeTimeoutMs: 300000,
  maxPairingAttempts: 5,
};

export class DmPolicyEngine {
  private config: DmPolicyConfig;
  private pairings: PairingStore;
  private pairingAttempts: Map<string, number> = new Map();

  constructor(config?: Partial<DmPolicyConfig>, pairings?: PairingStore) {
    this.config = { ...DEFAULT_POLICY_CONFIG, ...config };
    this.pairings = pairings || new PairingStore();
  }

  async authorize(
    ctx: MessageContext
  ): Promise<{ allowed: boolean; reason?: string; pairingCode?: string }> {
    switch (this.config.policy) {
      case 'open':
        return { allowed: true };
      case 'allowlist':
        return this.authorizeAllowlist(ctx);
      case 'pairing':
        return this.authorizePairing(ctx);
      default:
        return {
          allowed: false,
          reason: `未知 DM Policy: ${this.config.policy}`,
        };
    }
  }

  private async authorizeAllowlist(
    ctx: MessageContext
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (this.config.allowFrom.includes('*')) {
      return { allowed: true };
    }
    if (
      this.config.allowFrom.includes(ctx.senderId) ||
      this.config.allowFrom.includes(ctx.senderName || '')
    ) {
      return { allowed: true };
    }
    return { allowed: false, reason: `发送者 ${ctx.senderId} 不在白名单中` };
  }

  private async authorizePairing(
    ctx: MessageContext
  ): Promise<{ allowed: boolean; reason?: string; pairingCode?: string }> {
    const approved = await this.pairings.isApproved(
      ctx.channelId,
      ctx.senderId
    );
    if (approved) {
      return { allowed: true };
    }

    const attempts = (this.pairingAttempts.get(ctx.senderId) || 0) + 1;
    this.pairingAttempts.set(ctx.senderId, attempts);

    if (attempts > this.config.maxPairingAttempts) {
      logger.warning(`配对尝试超限: ${ctx.senderId} (${attempts}次)`);
      return { allowed: false, reason: `配对尝试次数超限` };
    }

    const pairingCode = await this.pairings.generateCode(
      ctx.channelId,
      ctx.senderId,
      this.config.pairingCodeTimeoutMs
    );
    logger.info(`生成配对码: ${ctx.senderId} → ${pairingCode}`);
    return {
      allowed: false,
      reason: `需要配对。请管理员运行: Liri pairing approve ${ctx.channelId} ${pairingCode}`,
      pairingCode,
    };
  }

  async approvePairing(channelId: string, userId: string): Promise<boolean> {
    return this.pairings.approve(channelId, userId);
  }

  async approvePairingByCode(
    channelId: string,
    code: string
  ): Promise<boolean> {
    return this.pairings.approveByCode(channelId, code);
  }

  async revokePairing(channelId: string, userId: string): Promise<boolean> {
    return this.pairings.revoke(channelId, userId);
  }

  listApprovedUsers(channelId: string): string[] {
    return this.pairings.listApproved(channelId);
  }

  updatePolicy(config: Partial<DmPolicyConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info(`DM Policy 已更新: ${this.config.policy}`);
  }

  getPolicy(): DmPolicy {
    return this.config.policy;
  }

  getConfig(): DmPolicyConfig {
    return { ...this.config };
  }
}
