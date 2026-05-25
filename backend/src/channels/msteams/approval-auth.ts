/**
 * Microsoft Teams 通道 DM 配对审批授权模块
 * 对标 OpenClaw extensions/msteams/src/approval-auth.ts
 *
 * 提供 sender 身份认证、审批人解析、allowlist 检查。
 * Teams 用户 ID 为 UUID 格式 (8-4-4-4-12)
 */

/** 审批人信息 */
export interface MSTeamsApproverInfo {
  userId: string;
  name?: string;
}

/** 审批授权配置 */
export interface MSTeamsApprovalAuthConfig {
  allowFrom?: string[];
  defaultTo?: string[];
}

/** 审批授权结果 */
export interface MSTeamsApprovalAuthResult {
  authorized: boolean;
  approvers: MSTeamsApproverInfo[];
  reason?: string;
}

/** Teams 用户 UUID 格式 */
const MSTEAMS_USER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 规范化 Teams 审批人 ID
 * Teams 用户 ID 是 UUID 格式
 */
export function normalizeMSTeamsApproverId(value: string): string | undefined {
  const trimmed = value.trim();

  if (trimmed.startsWith('user:')) {
    const id = trimmed.slice(5).trim();
    if (MSTEAMS_USER_ID_RE.test(id)) {
      return id.toLowerCase();
    }
    return undefined;
  }

  if (MSTEAMS_USER_ID_RE.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  return undefined;
}

/**
 * 从配置中解析审批人列表
 */
export function resolveMSTeamsApprovers(
  config: MSTeamsApprovalAuthConfig
): MSTeamsApproverInfo[] {
  const allowFrom = config.allowFrom ?? [];

  if (allowFrom.length === 0 && config.defaultTo) {
    return config.defaultTo
      .map((id: string) => {
        const normalized = normalizeMSTeamsApproverId(id);
        return normalized ? { userId: normalized } : null;
      })
      .filter(
        (x: MSTeamsApproverInfo | null): x is MSTeamsApproverInfo => x !== null
      );
  }

  return allowFrom
    .map((id: string) => {
      const normalized = normalizeMSTeamsApproverId(id);
      return normalized ? { userId: normalized } : null;
    })
    .filter(
      (x: MSTeamsApproverInfo | null): x is MSTeamsApproverInfo => x !== null
    );
}

/**
 * 检查 sender 是否已获授权
 */
export function isMSTeamsSenderAuthorized(
  senderId: string,
  config: MSTeamsApprovalAuthConfig
): MSTeamsApprovalAuthResult {
  const normalized = normalizeMSTeamsApproverId(senderId);

  if (!normalized) {
    return {
      authorized: false,
      approvers: [],
      reason: `无效的 Teams 用户 ID 格式: ${senderId}`,
    };
  }

  const approvers = resolveMSTeamsApprovers(config);

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
