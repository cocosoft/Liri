// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * toolAuthorization —— 长程任务（LRO）步骤工具的**权限层接线**（2026-11-09）
 *
 * **问题（用户真机反馈）**：会话权限选了「全自动」，长程任务里仍弹命令审批。
 * 两个独立原因：
 * 1. LRO 的步骤工具是**直接** `tool.execute()`（仅做工作区越界 / 必填参数校验），
 *    从未经过权限层 `authorizeToolCall` ⇒ 会话 `permission_mode` 在长程任务里**没接线**；
 * 2. bash 安全闸的 ask（`security_analyzer_ask` 等）**独立于权限层**，只看「命令是否批准过」。
 *
 * 本模块只补 1：与聊天链**同源**（`authorizeToolCall`）判定，并把"权限层已自动放行"回传，
 * 由调用方写进 `ToolUseContext.policyContext.autoApproved`，工具侧据此跳过 **ask 级**安全闸；
 * `deny` / 危险命令 / 路径越界 / 沙箱等**硬拦截不变**（工具内部照跑）。
 */

import { getLogger } from '@openliri/infra/monitoring';
import {
  authorizeToolCall,
  getEffectivePermissionRole,
  getEffectivePermissionRoles,
  PermissionManager,
  PERMISSION_MODES,
  type AuthorizeOutcome,
  type PermissionMode,
} from '@openliri/infra/permission';
import { getTaskSessionPolicyPort } from './taskSessionPolicyPort.js';
// 2026-11-11：LRO 步骤工具与聊天主链同源携带身份位（本地=admin；用户级 RBAC 依赖 userId）
import { getRequestPrincipal } from '@openliri/kernel/identity/requestScope.js';

const logger = getLogger('tasks:lro:toolAuthorization');

/** 判定结论（调用方只认这三种） */
export type LroToolAuthDecision =
  | {
      kind: 'allow';
      /** true = 权限层放宽档自动放行（工具可跳过 ask 级安全闸） */
      autoApproved: boolean;
      permissionMode?: PermissionMode;
    }
  | {
      /**
       * 需人工审批（权限层已提交 Inbox）：**本次不执行**（P1-6，2026-11-11 起与
       * `authorizeToolCall` 契约一致；批准后重试该步骤即走放行缓存）。
       */
      kind: 'ask';
      permissionMode?: PermissionMode;
      reason?: string;
    }
  | { kind: 'deny'; reason?: string };

/** 归一权限模式（脏值 ⇒ undefined，不猜） */
function normalizeMode(raw: unknown): PermissionMode | undefined {
  if (typeof raw !== 'string') return undefined;
  const normalized = raw.trim().toLowerCase();
  return PERMISSION_MODES.find((m) => m.toLowerCase() === normalized);
}

/**
 * 把 `authorizeToolCall` 的结论归类（**纯函数**，供单测直驱）。
 *
 * 口径：`allowed` ⇒ allow（`autoApproved` 透传）；`ask` ⇒ ask；其余 ⇒ deny。
 */
export function classifyAuthOutcome(
  outcome: AuthorizeOutcome,
  permissionMode?: PermissionMode
): LroToolAuthDecision {
  if (outcome.allowed) {
    return {
      kind: 'allow',
      autoApproved: outcome.autoApproved === true,
      ...(permissionMode ? { permissionMode } : {}),
    };
  }
  if (outcome.kind === 'ask') {
    return {
      kind: 'ask',
      ...(permissionMode ? { permissionMode } : {}),
      ...(outcome.reason ? { reason: outcome.reason } : {}),
    };
  }
  return {
    kind: 'deny',
    ...(outcome.reason ? { reason: outcome.reason } : {}),
  };
}

/**
 * 判定一次 LRO 步骤工具调用。
 *
 * 权限层故障（判定抛错 / 端口异常）⇒ **fail-closed 返回 deny**（P1-6，2026-11-11）：
 * 调用方不得执行，把原因交回模型；不再以 `undefined` 让调用方"保持旧行为"。
 */
export async function authorizeLroToolCall(input: {
  taskId: string;
  sessionId?: string | null;
  /**
   * 本步**实际执行**的工作区（LRO 隔离工作区）。
   *
   * 提供 ⇒ 权限层按它判路径边界（缺省才回落到会话工作区根）—— 长程任务在隔离工作区
   * 里读写，按会话根判会把正常产物判成越界。
   */
  workspacePath?: string | null;
  toolName: string;
  args: Record<string, unknown>;
}): Promise<LroToolAuthDecision> {
  const sessionId = input.sessionId ?? undefined;
  try {
    const sessionPolicy = sessionId
      ? getTaskSessionPolicyPort()?.capture(sessionId)
      : undefined;
    const permissionMode = normalizeMode(sessionPolicy?.permissionMode);
    const taskWorkspace =
      typeof input.workspacePath === 'string' && input.workspacePath.trim()
        ? input.workspacePath.trim()
        : undefined;
    const rawRoots = sessionPolicy?.workspaceRoots;
    const sessionRoots = Array.isArray(rawRoots)
      ? rawRoots.filter((p): p is string => typeof p === 'string')
      : [];
    const workspaceRoots = taskWorkspace ? [taskWorkspace] : sessionRoots;
    const effectiveRole = getEffectivePermissionRole();
    // P2-6（2026-11-11）：RBAC 按角色并集判定（多角色用户全部绑定生效）
    const effectiveRoles = getEffectivePermissionRoles();
    const outcome = await authorizeToolCall(PermissionManager.getInstance(), {
      toolName: input.toolName,
      args: input.args,
      context: {
        ...(sessionId ? { sessionId } : {}),
        taskId: input.taskId,
        userId: getRequestPrincipal().userId,
        ...(effectiveRole ? { userRole: effectiveRole } : {}),
        ...(effectiveRoles.length > 0 ? { userRoles: effectiveRoles } : {}),
        ...(permissionMode ? { permissionMode } : {}),
        ...(sessionPolicy?.approvalMode === 'auto-local'
          ? { approvalMode: 'auto-local' as const }
          : {}),
        ...(workspaceRoots.length > 0
          ? {
              workspacePath: workspaceRoots[0],
              workspaceRoots,
            }
          : {}),
      },
    });
    const decision = classifyAuthOutcome(outcome, permissionMode);
    if (decision.kind !== 'allow') {
      logger.info('LRO 工具权限判定非放行', {
        taskId: input.taskId,
        sessionId,
        toolName: input.toolName,
        kind: decision.kind,
        permissionMode,
        reason: decision.reason,
      });
    } else if (decision.autoApproved) {
      // 留证：长程任务里"没有弹卡"是因为会话放宽档自动放行，而不是安全闸没跑
      logger.info('LRO 工具调用按会话权限档自动放行', {
        taskId: input.taskId,
        sessionId,
        toolName: input.toolName,
        permissionMode,
      });
    }
    return decision;
  } catch (err) {
    // P1-6（2026-11-11）：**fail-closed**。此前返回 `undefined` ⇒ 调用方按旧行为直接执行，
    // 权限层故障等于绕过全部 RBAC / ask 规则（与 P1-3「读不到就拒绝」口径矛盾）。
    logger.warn('LRO 工具权限判定失败（fail-closed：拒绝本次执行）', {
      taskId: input.taskId,
      toolName: input.toolName,
      error: String(err),
    });
    return {
      kind: 'deny',
      reason: `权限层不可用：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
