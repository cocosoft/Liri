/**
 * 审批卡状态转移审计（2026-11-24 从 `InboxManager.auditStatusChange` 逐字外迁，FSZ-006 拆分）
 *
 * P2-1（R09-013）：只在**真实 UPDATE 生效后**调用；`sessionId` 缺失 ⇒ 无会话可挂 ⇒ 如实不落。
 * 独立成模块的原因：过期扫描外迁后仍需同一实现（单一实现，禁止双轨）。
 */

import { emitStateTransitionAudit } from '@openliri/infra/state/engine/stateTransitionAudit';
import type { InboxItemStatus } from '../InboxManager.js';

export function auditInboxStatusChange(
  sessionId: string | undefined,
  inboxId: string,
  from: string,
  to: InboxItemStatus,
  reason: string
): void {
  emitStateTransitionAudit(sessionId, {
    machine: 'inboxApproval',
    from,
    to,
    reason,
    subjectId: inboxId,
  });
}
