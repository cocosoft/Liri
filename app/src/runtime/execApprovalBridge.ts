/**
 * execApprovalBridge — 企业审批流接线（`ExecApprovalManager` ← 工具 ASK）
 *
 * **默认关**：只有显式开启才把「已提交 Inbox 的工具审批」镜像成一条企业审批请求。
 *
 * 口径（2026-10-21 裁定 · 复用现有审批面）：
 *   1) **呈现面复用 Inbox** —— 不新开企业审批页面；企业侧是一个**额外的批准入口**；
 *   2) **单赢** —— 两侧都走 `runtime/inboxApproval#resolveInboxApproval`（CAS 抢锁），
 *      先落地者生效，另一方得到 `concurrent_conflict` / 被取消；
 *   3) **超时只收敛企业侧** —— `ExecApprovalManager` 到点 `timed_out` 时**不动 Inbox**
 *      （Inbox 自己有过期语义），避免"企业侧超时把用户自己的审批卡也废掉"；
 *   4) 企业侧的批准/拒绝**留审计**（`approval_action`），actor 取审批人。
 *
 * 开关（默认 false）：
 *   - 配置：`enterprise.approval.execution.enabled === true`
 *   - 环境：`LIRI_EXEC_APPROVAL_ENABLED=1`
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { configManager } from '@modules/config';
import {
  createExecApprovalManager,
  type ExecApprovalManager,
  type ExecApprovalStatus,
} from '@modules/config/enterprise/audit/ExecApprovalManager.js';
import {
  resolveInboxApproval,
  onInboxApprovalResolved,
} from './inboxApproval.js';

const logger = getLogger('runtime:execApprovalBridge');

/** 企业侧审批入口是否启用（默认关；桌面/CLI 零行为变更）*/
export function isEnterpriseExecApprovalEnabled(): boolean {
  if (configManager.env('LIRI_EXEC_APPROVAL_ENABLED') === '1') return true;
  return (
    configManager.getValue<boolean>('enterprise.approval.execution.enabled') ===
    true
  );
}

/** 企业侧审批超时（毫秒）：配置缺省 ⇒ 120s（与 `ExecApprovalManager` 默认一致）*/
export function resolveExecApprovalTimeoutMs(): number {
  const configured = configManager.getValue<number>(
    'enterprise.approval.execution.timeoutMs'
  );
  return typeof configured === 'number' && configured > 0
    ? configured
    : 120_000;
}

/**
 * 企业审批状态 → Inbox 回复值
 *
 * - `approved` ⇒ `approve`（本次执行）
 * - `rejected` ⇒ `reject`
 * - 其余（`timed_out` / `cancelled`）⇒ `null`（**不动 Inbox**，见文件头口径 3）
 */
export function enterpriseStatusToInboxReply(
  status: ExecApprovalStatus
): 'approve' | 'reject' | null {
  if (status === 'approved') return 'approve';
  if (status === 'rejected') return 'reject';
  return null;
}

/** 镜像关系：Inbox 项 id → 企业审批请求 id（用于 Inbox 先落地时取消企业侧）*/
const mirrored = new Map<string, string>();

let manager: ExecApprovalManager | null = null;
let unsubscribed: (() => void) | null = null;

function getManager(): ExecApprovalManager {
  if (!manager) {
    manager = createExecApprovalManager({
      defaultTimeoutMs: resolveExecApprovalTimeoutMs(),
      verbose: false,
    });
    // Inbox 先落地 ⇒ 取消企业侧镜像请求（避免"两边都待批"，也避免第二次批准拿到冲突）
    unsubscribed = onInboxApprovalResolved((inboxId) => {
      const requestId = mirrored.get(inboxId);
      if (!requestId) return;
      mirrored.delete(inboxId);
      void manager
        ?.cancel(requestId, '已在 Inbox 侧批复')
        .catch((error: unknown) => {
          logger.debug('取消企业审批镜像失败（多半已终结）', {
            inboxId,
            requestId,
            error: String(error),
          });
        });
    });
  }
  return manager;
}

export interface MirrorAskInput {
  /** 已提交的 Inbox 审批项 id（缺失 ⇒ 不镜像）*/
  inboxItemId?: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  /** 请求人（渠道发送者 / 用户名；缺省由调用方给 `unknown`）*/
  requester: string;
  /** 审批说明（通常是权限拒绝原因）*/
  description: string;
  sessionId?: string;
}

/**
 * 可注入依赖（**仅供测试**：让"企业批准 → 回灌 Inbox"能被单测，不必真起 DB/审批管理器）
 */
export interface ExecApprovalBridgeDeps {
  createManager?: () => ExecApprovalManager;
  resolveInbox?: (id: string, reply: string) => Promise<{ kind: string }>;
  audit?: (input: {
    inboxId: string;
    reply: 'approve' | 'reject';
    approvedBy: string;
    outcome: string;
  }) => Promise<void>;
}

/**
 * 把一次"已提交 Inbox 的工具审批"镜像为企业审批请求（fire-and-forget）
 *
 * @returns 企业审批请求 id；未启用 / 缺 inboxItemId ⇒ `undefined`
 */
export function mirrorAskToEnterpriseApproval(
  input: MirrorAskInput,
  deps: ExecApprovalBridgeDeps = {}
): string | undefined {
  if (!input.inboxItemId) return undefined;
  if (!isEnterpriseExecApprovalEnabled()) return undefined;

  try {
    const inboxId = input.inboxItemId;
    const exec = (deps.createManager ?? getManager)();
    const resolveInbox = deps.resolveInbox ?? resolveInboxApproval;

    // 同步建请求（拿到确定的 id 以登记镜像关系）；**不 await 结果**——决出是异步的
    const request = exec.createRequest(
      input.toolName,
      input.toolInput,
      input.requester,
      input.description,
      inboxId
    );
    mirrored.set(inboxId, request.id);

    void exec
      .waitForDecision(request.id)
      .then(async (decided) => {
        mirrored.delete(inboxId);
        const reply = enterpriseStatusToInboxReply(decided.status);
        if (!reply) {
          logger.info('企业审批未决出批准/拒绝，Inbox 保持原状', {
            inboxId,
            status: decided.status,
          });
          return;
        }
        const approvedBy = decided.decision?.approvedBy ?? 'enterprise';
        const outcome = await resolveInbox(inboxId, reply);
        if (deps.audit) {
          await deps.audit({
            inboxId,
            reply,
            approvedBy,
            outcome: outcome.kind,
          });
        } else {
          await recordEnterpriseApprovalAudit({
            inboxId,
            toolName: input.toolName,
            sessionId: input.sessionId,
            reply,
            approvedBy,
            outcome: outcome.kind,
          });
        }
        logger.info('企业审批已回灌 Inbox', {
          inboxId,
          reply,
          approvedBy,
          outcome: outcome.kind,
        });
      })
      .catch((error: unknown) =>
        handleError(error, {
          module: 'runtime:execApprovalBridge',
          action: 'mirrorAsk',
          context: { inboxId, toolName: input.toolName },
        })
      );

    return request.id;
  } catch (error) {
    void handleError(error, {
      module: 'runtime:execApprovalBridge',
      action: 'mirrorAskSync',
      context: { toolName: input.toolName },
    });
    return undefined;
  }
}

/** 企业审批落定的审计（失败只告警：审批已生效，审计是旁路）*/
async function recordEnterpriseApprovalAudit(input: {
  inboxId: string;
  toolName: string;
  sessionId?: string;
  reply: 'approve' | 'reject';
  approvedBy: string;
  outcome: string;
}): Promise<void> {
  try {
    const { EnterpriseAuditService, AuditEventType } =
      await import('../config/enterprise/audit/EnterpriseAuditService.js');
    await EnterpriseAuditService.getInstance().log(
      AuditEventType.APPROVAL_ACTION,
      'info',
      input.approvedBy,
      `enterprise.approval.${input.reply}`,
      {
        resource: `inbox:${input.inboxId}`,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        details: {
          toolName: input.toolName,
          inboxId: input.inboxId,
          decision: input.reply,
          approvalSurface: 'enterprise',
          inboxOutcome: input.outcome,
        },
      }
    );
  } catch (error) {
    logger.warn('企业审批审计写入失败（旁路）', {
      inboxId: input.inboxId,
      error: String(error),
    });
  }
}

/** 仅供测试/诊断：重置镜像关系与单例（不发请求、不改配置）*/
export function __resetExecApprovalBridgeForTest(): void {
  mirrored.clear();
  unsubscribed?.();
  unsubscribed = null;
  manager = null;
}

/** 仅供测试/诊断：当前镜像关系快照 */
export function __getMirroredApprovalsForTest(): Map<string, string> {
  return new Map(mirrored);
}
