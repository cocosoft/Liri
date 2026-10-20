/**
 * MobileAudit — 移动端入站/配对的**审计落盘**（P2.5，2026-10-20）
 *
 * 复用既有企业审计设施（`config/enterprise/audit/EnterpriseAuditService`，
 * 落 `{logs}/enterprise-audit/{date}_audit.json`），不新造第二套审计存储（CS01）。
 *
 * 口径（方案 §2.6「审计」）：每条事件都带 `channel='mobile'` + `deviceId`；
 * 敏感动作（配对 / 鉴权拒绝）记为 `authentication`，消息入站记为 `data_access`。
 *
 * ⚠️ **审计是旁路**：写入失败只告警、不阻断消息主流程（与既有审计实现一致）。
 */

import { getLogger } from '@modules/monitoring';

const logger = getLogger('channels:mobile:audit');

/** 移动端审计事件 */
export type MobileAuditEvent =
  | {
      kind: 'message_received';
      deviceId: string;
      conversationId: string;
      messageId: string;
      textLength: number;
      success: boolean;
      reason?: string;
    }
  | {
      kind: 'pairing';
      deviceId: string;
      success: boolean;
      reason?: string;
    }
  | {
      kind: 'auth_denied';
      deviceId: string;
      reason: string;
    };

/**
 * 审计载荷（**纯函数输出**：便于单测，不触发文件 IO）。
 *
 * `type` 取 `AuditEventType` 的**字符串值**（`authentication` / `data_access`），
 * 由 `recordMobileAudit` 再映射为枚举成员。
 */
export interface MobileAuditPayload {
  type: 'authentication' | 'data_access';
  severity: 'info' | 'warning';
  actor: string;
  action: string;
  resource: 'channel:mobile';
  success: boolean;
  failureReason?: string;
  details: Record<string, unknown>;
}

export function buildMobileAuditPayload(
  event: MobileAuditEvent
): MobileAuditPayload {
  if (event.kind === 'message_received') {
    return {
      type: 'data_access',
      severity: 'info',
      actor: event.deviceId,
      action: 'mobile.message.received',
      resource: 'channel:mobile',
      success: event.success,
      ...(event.reason ? { failureReason: event.reason } : {}),
      details: {
        channel: 'mobile',
        deviceId: event.deviceId,
        conversationId: event.conversationId,
        messageId: event.messageId,
        textLength: event.textLength,
      },
    };
  }

  if (event.kind === 'pairing') {
    return {
      type: 'authentication',
      severity: 'info',
      actor: event.deviceId,
      action: 'mobile.pairing.verify',
      resource: 'channel:mobile',
      success: event.success,
      ...(event.reason ? { failureReason: event.reason } : {}),
      details: {
        channel: 'mobile',
        deviceId: event.deviceId,
      },
    };
  }

  return {
    type: 'authentication',
    severity: 'warning',
    actor: event.deviceId,
    action: 'mobile.auth.denied',
    resource: 'channel:mobile',
    success: false,
    failureReason: event.reason,
    details: {
      channel: 'mobile',
      deviceId: event.deviceId,
    },
  };
}

/**
 * 写入审计（best-effort）：失败只告警，不阻断主流程。
 *
 * 动态 import 审计服务：避免在未使用移动端时把企业审计的初始化（建目录 + 定时器）
 * 拉进 HTTP 启动面。
 */
export async function recordMobileAudit(
  event: MobileAuditEvent
): Promise<void> {
  const payload = buildMobileAuditPayload(event);
  try {
    const { EnterpriseAuditService, AuditEventType } =
      await import('../../config/enterprise/audit/EnterpriseAuditService');
    const service = EnterpriseAuditService.getInstance();
    await service.log(
      payload.type === 'authentication'
        ? AuditEventType.AUTHENTICATION
        : AuditEventType.DATA_ACCESS,
      payload.severity,
      payload.actor,
      payload.action,
      {
        details: payload.details,
        resource: payload.resource,
        success: payload.success,
        ...(payload.failureReason
          ? { failureReason: payload.failureReason }
          : {}),
      }
    );
  } catch (error) {
    logger.warn('移动端审计写入失败（旁路，不阻断主流程）', {
      action: payload.action,
      error: String(error),
    });
  }
}
