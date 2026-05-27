/**
 * Google Chat 通道 DM 配对审批授权模块
 * 对标 OpenClaw extensions/googlechat/src/approval-auth.ts
 *
 * 提供 sender 身份认证、审批人解析、allowlist 检查。
 */

/** 审批人信息 */
export interface GoogleChatApproverInfo {
  userId: string;
  name?: string;
}

/** 审批授权配置 */
export interface GoogleChatApprovalAuthConfig {
  allowFrom?: string[];
}

/** 审批授权结果 */
export interface GoogleChatApprovalAuthResult {
  authorized: boolean;
  approvers: GoogleChatApproverInfo[];
  reason?: string;
}

/** Google Chat 用户 ID 格式 */

/**
 * 规范化 Google Chat 审批人 ID
 */
export function normalizeGoogleChatApproverId(
  value: string
): string | undefined {
  const trimmed = value.trim().toLowerCase();

  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed;
}

/**
 * 从配置中解析审批人列表
 */
export function resolveGoogleChatApprovers(
  config: GoogleChatApprovalAuthConfig
): GoogleChatApproverInfo[] {
  const allowFrom = config.allowFrom ?? [];

  return allowFrom
    .map((id: string) => {
      const normalized = normalizeGoogleChatApproverId(id);
      return normalized ? { userId: normalized } : null;
    })
    .filter(
      (x: GoogleChatApproverInfo | null): x is GoogleChatApproverInfo =>
        x !== null
    );
}

/**
 * 检查 sender 是否已获授权
 */
export function isGoogleChatSenderAuthorized(
  senderId: string,
  config: GoogleChatApprovalAuthConfig
): GoogleChatApprovalAuthResult {
  const normalized = normalizeGoogleChatApproverId(senderId);

  if (!normalized) {
    return {
      authorized: false,
      approvers: [],
      reason: `无效的 sender ID 格式: ${senderId}`,
    };
  }

  const approvers = resolveGoogleChatApprovers(config);

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
