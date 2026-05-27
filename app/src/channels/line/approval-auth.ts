/**
 * LINE 通道 DM 配对审批授权模块
 * 对标 OpenClaw extensions/line/src/approval-auth.ts
 *
 * 提供 sender 身份认证、审批人解析、allowlist 检查。
 * LINE 用户 ID 由 Messaging API 分配，格式为 Uxxx
 */

/** 审批人信息 */
export interface LineApproverInfo {
  userId: string;
  name?: string;
}

/** 审批授权配置 */
export interface LineApprovalAuthConfig {
  allowFrom?: string[];
}

/** 审批授权结果 */
export interface LineApprovalAuthResult {
  authorized: boolean;
  approvers: LineApproverInfo[];
  reason?: string;
}

/** LINE 用户 ID 格式：U 开头 */
const LINE_USER_ID_RE = /^U[a-f0-9]{32}$/i;

/**
 * 规范化 LINE 审批人 ID
 * LINE 用户 ID 为 U + 32 位十六进制
 */
export function normalizeLineApproverId(value: string): string | undefined {
  const trimmed = value.trim();
  if (LINE_USER_ID_RE.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}

/**
 * 从配置中解析审批人列表
 */
export function resolveLineApprovers(
  config: LineApprovalAuthConfig
): LineApproverInfo[] {
  const allowFrom = config.allowFrom ?? [];

  return allowFrom
    .map((id: string) => {
      const normalized = normalizeLineApproverId(id);
      return normalized ? { userId: normalized } : null;
    })
    .filter((x: LineApproverInfo | null): x is LineApproverInfo => x !== null);
}

/**
 * 检查 sender 是否已获授权
 */
export function isLineSenderAuthorized(
  senderId: string,
  config: LineApprovalAuthConfig
): LineApprovalAuthResult {
  const normalized = normalizeLineApproverId(senderId);

  if (!normalized) {
    return {
      authorized: false,
      approvers: [],
      reason: `无效的 LINE 用户 ID 格式: ${senderId}`,
    };
  }

  const approvers = resolveLineApprovers(config);

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
