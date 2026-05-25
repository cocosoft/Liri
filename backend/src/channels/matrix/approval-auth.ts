/**
 * Matrix 通道 DM 配对审批授权模块
 * 对标 OpenClaw extensions/matrix/src/approval-auth.ts
 *
 * 提供 sender 身份认证、审批人解析、allowlist 检查。
 * Matrix 用户 ID 格式：@user:server
 */

/** 审批人信息 */
export interface MatrixApproverInfo {
  userId: string;
  name?: string;
}

/** 审批授权配置 */
export interface MatrixApprovalAuthConfig {
  allowFrom?: string[];
}

/** 审批授权结果 */
export interface MatrixApprovalAuthResult {
  authorized: boolean;
  approvers: MatrixApproverInfo[];
  reason?: string;
}

/** Matrix 用户 ID 格式：@user:server */
const MATRIX_USER_ID_RE = /^@[a-z0-9._=\-/+]+:[a-z0-9.\-]+(:[0-9]+)?$/i;

/**
 * 规范化 Matrix 审批人 ID
 * Matrix 用户 ID 为 @user:server 格式
 */
export function normalizeMatrixApproverId(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (MATRIX_USER_ID_RE.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}

/**
 * 从配置中解析审批人列表
 */
export function resolveMatrixApprovers(
  config: MatrixApprovalAuthConfig
): MatrixApproverInfo[] {
  const allowFrom = config.allowFrom ?? [];

  return allowFrom
    .map((id: string) => {
      const normalized = normalizeMatrixApproverId(id);
      return normalized ? { userId: normalized } : null;
    })
    .filter((x: MatrixApproverInfo | null): x is MatrixApproverInfo => x !== null);
}

/**
 * 检查 sender 是否已获授权
 */
export function isMatrixSenderAuthorized(
  senderId: string,
  config: MatrixApprovalAuthConfig
): MatrixApprovalAuthResult {
  const normalized = normalizeMatrixApproverId(senderId);

  if (!normalized) {
    return {
      authorized: false,
      approvers: [],
      reason: `无效的 Matrix 用户 ID 格式: ${senderId}`,
    };
  }

  const approvers = resolveMatrixApprovers(config);

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
