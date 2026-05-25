/**
 * 飞书通道 DM 配对审批授权模块
 * 对标 OpenClaw extensions/feishu/src/approval-auth.ts
 *
 * 提供 sender 身份认证、审批人解析、allowlist 检查。
 */

/** 审批人信息 */
export interface FeishuApproverInfo {
  userId: string;
  name?: string;
}

/** 审批授权配置 */
export interface FeishuApprovalAuthConfig {
  allowFrom?: string[];
  accountId?: string;
}

/** 审批授权结果 */
export interface FeishuApprovalAuthResult {
  authorized: boolean;
  approvers: FeishuApproverInfo[];
  reason?: string;
}

/** 飞书用户 ID 格式：ou_xxx */
const FEISHU_OPEN_ID_RE = /^ou_[a-zA-Z0-9]{20,40}$/;

/**
 * 规范化飞书审批人 ID
 * 验证 open_id 格式 (ou_xxx)
 */
export function normalizeFeishuApproverId(value: string): string | undefined {
  const trimmed = value.trim();
  if (FEISHU_OPEN_ID_RE.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}

/**
 * 从配置中解析审批人列表
 */
export function resolveFeishuApprovers(
  config: FeishuApprovalAuthConfig
): FeishuApproverInfo[] {
  const allowFrom = config.allowFrom ?? [];

  return allowFrom
    .map((id: string) => {
      const normalized = normalizeFeishuApproverId(id);
      return normalized ? { userId: normalized } : null;
    })
    .filter(
      (x: FeishuApproverInfo | null): x is FeishuApproverInfo => x !== null
    );
}

/**
 * 检查 sender 是否已获授权
 */
export function isFeishuSenderAuthorized(
  senderId: string,
  config: FeishuApprovalAuthConfig
): FeishuApprovalAuthResult {
  const normalized = normalizeFeishuApproverId(senderId);

  if (!normalized) {
    return {
      authorized: false,
      approvers: [],
      reason: `无效的飞书 open_id 格式: ${senderId}`,
    };
  }

  const approvers = resolveFeishuApprovers(config);

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
