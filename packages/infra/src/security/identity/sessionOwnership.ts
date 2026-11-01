/**
 * sessionOwnership — 会话归属判定（多租户 P1）
 *
 * 归属写在 `SessionMetadata.owner`（`{ tenantId, userId }`），创建时由**请求身份**写入。
 * 本地身份创建的会话**不写归属**（`owner` 缺省）—— 桌面单用户下没有"别人的会话"这一概念，
 * 且历史会话（P1 之前创建）也都没有该字段。
 *
 * 判定规则（fail-closed）：
 *   - 本地身份 ⇒ 恒 `true`（桌面端零行为变更，含历史无归属会话）；
 *   - 已认证身份 ⇒ 必须有归属且 tenant+user 完全一致；**无归属 ⇒ false**
 *     （远端身份不得访问本机历史会话）。
 */
import type { Principal } from '@openliri/kernel/identity/principal';
import { isLocalPrincipal } from '@openliri/kernel/identity/requestScope';

/** 会话归属（持久化在 `SessionMetadata.owner`） */
export interface SessionOwner {
  tenantId: string;
  userId: string;
}

/** 该身份创建会话时应写入的归属；本地身份 ⇒ `undefined`（不写字段，保持桌面会话文件逐字不变） */
export function ownerOf(principal: Principal): SessionOwner | undefined {
  if (isLocalPrincipal(principal)) return undefined;
  return { tenantId: principal.tenantId, userId: principal.userId };
}

/** 该身份能否访问这个会话（见文件头规则） */
export function canAccessSession(
  owner: SessionOwner | undefined | null,
  principal: Principal
): boolean {
  if (isLocalPrincipal(principal)) return true;
  if (!owner) return false;
  return (
    owner.tenantId === principal.tenantId && owner.userId === principal.userId
  );
}
