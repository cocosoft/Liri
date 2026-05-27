/**
 * Discord 通道 DM 配对审批授权模块
 * 对标 OpenClaw extensions/discord/src/approval-auth.ts
 *
 * 提供 sender 身份认证、审批人解析、allowlist 检查。
 * Discord 用户 ID 为 Snowflake 格式（数字字符串）
 */

/** 审批人信息 */
export interface DiscordApproverInfo {
  userId: string;
  name?: string;
}

/** 审批授权配置 */
export interface DiscordApprovalAuthConfig {
  allowFrom?: string[];
}

/** 审批授权结果 */
export interface DiscordApprovalAuthResult {
  authorized: boolean;
  approvers: DiscordApproverInfo[];
  reason?: string;
}

/** Discord Snowflake 格式：纯数字 */
const DISCORD_SNOWFLAKE_RE = /^\d{17,20}$/;

/**
 * 规范化 Discord 审批人 ID
 * Discord 用户 ID 为 Snowflake（数字字符串）
 */
export function normalizeDiscordApproverId(value: string): string | undefined {
  const trimmed = value.trim();
  if (DISCORD_SNOWFLAKE_RE.test(trimmed)) {
    return trimmed;
  }

  if (/^<@!?\d{17,20}>$/.test(trimmed)) {
    const inner = trimmed.replace(/^<@!?/, '').replace(/>$/, '');
    if (DISCORD_SNOWFLAKE_RE.test(inner)) {
      return inner;
    }
  }

  return undefined;
}

/**
 * 从配置中解析审批人列表
 */
export function resolveDiscordApprovers(
  config: DiscordApprovalAuthConfig
): DiscordApproverInfo[] {
  const allowFrom = config.allowFrom ?? [];

  return allowFrom
    .map((id: string) => {
      const normalized = normalizeDiscordApproverId(id);
      return normalized ? { userId: normalized } : null;
    })
    .filter(
      (x: DiscordApproverInfo | null): x is DiscordApproverInfo => x !== null
    );
}

/**
 * 检查 sender 是否已获授权
 */
export function isDiscordSenderAuthorized(
  senderId: string,
  config: DiscordApprovalAuthConfig
): DiscordApprovalAuthResult {
  const normalized = normalizeDiscordApproverId(senderId);

  if (!normalized) {
    return {
      authorized: false,
      approvers: [],
      reason: `无效的 Discord 用户 ID 格式: ${senderId}`,
    };
  }

  const approvers = resolveDiscordApprovers(config);

  if (approvers.length === 0) {
    return {
      authorized: true,
      approvers: [],
      reason: '未配置 allowFrom，默认放行',
    };
  }

  const matched = approvers.find((a) => a.userId === normalized);

  if (matched) {
    return {
      authorized: true,
      approvers,
      reason: 'sender 在 allowFrom 列表中',
    };
  }

  return {
    authorized: false,
    approvers,
    reason: `sender ${normalized} 不在 allowFrom 列表中`,
  };
}
