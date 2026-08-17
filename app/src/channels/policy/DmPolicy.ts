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
import { PairingStore, getPairingStore } from './PairingStore';

const logger = getLogger('channels:dm');

// DEEP-1/BUG-3：进程内共享配对尝试计数
// DmPolicyEngine 可能被每条消息新建，若尝试计数挂在实例上会每消息重置，
// 导致 maxPairingAttempts 永远无法触发。共享为模块级 Map。
const sharedPairingAttempts = new Map<string, number>();

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
  private pairingAttempts: Map<string, number> = sharedPairingAttempts;

  constructor(config?: Partial<DmPolicyConfig>, pairings?: PairingStore) {
    this.config = { ...DEFAULT_POLICY_CONFIG, ...config };
    // DEEP-1/BUG-3：默认使用进程内共享单例，避免每消息新建 PairingStore 导致配对状态不一致
    this.pairings = pairings || getPairingStore();
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
      // 配对成功后清除该发送者的尝试计数，避免共享 Map 无限增长
      this.pairingAttempts.delete(ctx.senderId);
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
