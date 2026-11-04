// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P1「单一入口」（`dev_docs/20261027/工具权限体系归一化方案-20261027.md` §5）——
 * `authorizeToolCall`：**一次工具调用授权判定的唯一调用点**。
 *
 * 背景（方案 §2 B2）：`ToolExecutionService.execute`（Agent 主链）走
 * `PermissionManager.checkPermissionForTool`，而 `ToolManager.executeTool`
 * （HTTP `POST /v1/tools/:name/execute`、部分远程/CoreAPI 入口）**没有任何权限门**
 * （`DefaultToolPolicy.evaluate()` 恒 allow）⇒ 绕过全部规则与审批。
 *
 * 本函数只做两件事：
 * 1. 统一入参（`toolName` / `args` / 上下文）；
 * 2. 把 `checkPermissionForTool` 的返回归一为 `AuthorizeOutcome`（P1-3 决策 DTO）。
 *
 * **不复制任何判定逻辑**：ask ⇒ 提交 Inbox 审批卡片的唯一实现仍在
 * `PermissionManager.checkPermissionForTool` 内（避免出现第二套口径）。
 */

import type { PermissionDenyInfo } from './types/PermissionDecision';
import type { PermissionMode } from './PermissionMode';

/** 工具授权上下文（与 `PermissionManager.checkPermissionForTool` 的 `context` 同构） */
export interface ToolAuthorizeContext {
  sessionId?: string;
  userId?: string;
  userRole?: string;
  /** 语义护栏「便宜版」：本轮意图文本 */
  metadata?: { goalText?: string };
  /** 会话级审批模式（缺省 ⇒ 权限层按 `ask` 处理） */
  approvalMode?: 'ask' | 'auto-local';
  /** P1（2026-11-04）：会话级权限模式（缺省 ⇒ 权限层的进程默认档） */
  permissionMode?: PermissionMode;
  /** 会话工作区路径（`auto-local` 的写边界） */
  workspacePath?: string;
  /**
   * P1（2026-11-04，方案 §3.6）：会话工作区**根列表**（首根 = 主工作区）。
   * 缺省 ⇒ 权限层回落单根 `workspacePath`（行为不变）。
   */
  workspaceRoots?: string[];
  /** 本次执行的沙箱信号（仅审批卡留证，不参与判定） */
  sandbox?: unknown;
  /** 非幂等工具重试 ⇒ 本应放行的决策升级为 ask */
  forceAskReason?: string;
  /** 已注册工具对象（风险按声明式派生；缺省 ⇒ 权限层回退旧启发式） */
  tool?: unknown;
}

/** 权限管理器的最小端口（只依赖主链实际调用的一个方法） */
export interface ToolPermissionPort {
  checkPermissionForTool(
    name: string,
    input?: Record<string, unknown>,
    context?: ToolAuthorizeContext
  ): Promise<ToolPermissionPortResult>;
}

/** `checkPermissionForTool` 的返回结构（与 `PermissionManager` 实现逐字段对齐） */
export interface ToolPermissionPortResult {
  allowed: boolean;
  decision?: { behavior: string; reason?: string };
  reason?: string;
  submittedToInbox?: boolean;
  commandHash?: string;
  inboxItemId?: string;
  denyInfo?: PermissionDenyInfo;
}

/** 归一后的授权结论（调用方只认这一个 DTO） */
export type AuthorizeOutcome =
  | { allowed: true; reason?: string }
  | {
      allowed: false;
      kind: 'ask';
      reason: string;
      /** 审批卡片是否已由权限层提交到 Inbox */
      submittedToInbox: boolean;
      inboxItemId?: string;
      commandHash?: string;
      denyInfo?: PermissionDenyInfo;
    }
  | {
      allowed: false;
      kind: 'deny';
      reason: string;
      denyInfo?: PermissionDenyInfo;
    };

/** 一次授权请求 */
export interface AuthorizeToolCallRequest {
  toolName: string;
  args: Record<string, unknown>;
  context?: ToolAuthorizeContext;
}

/**
 * 执行一次工具授权判定（**唯一入口**）。
 *
 * 语义约定：`allowed:false` + `kind:'ask'` ⇒ 调用方**不得执行工具**，
 * 只能把「等待批准」如实回传给上层（审批卡由权限层提交）。
 */
export async function authorizeToolCall(
  port: ToolPermissionPort,
  request: AuthorizeToolCallRequest
): Promise<AuthorizeOutcome> {
  const result = await port.checkPermissionForTool(
    request.toolName,
    request.args,
    request.context
  );

  if (result.allowed) {
    return result.reason ? { allowed: true, reason: result.reason } : { allowed: true };
  }

  const reason =
    result.reason ||
    result.decision?.reason ||
    'Tool execution not allowed';

  if (result.decision?.behavior === 'ask') {
    return {
      allowed: false,
      kind: 'ask',
      reason,
      submittedToInbox: result.submittedToInbox === true,
      ...(result.inboxItemId ? { inboxItemId: result.inboxItemId } : {}),
      ...(result.commandHash ? { commandHash: result.commandHash } : {}),
      ...(result.denyInfo ? { denyInfo: result.denyInfo } : {}),
    };
  }

  return {
    allowed: false,
    kind: 'deny',
    reason,
    ...(result.denyInfo ? { denyInfo: result.denyInfo } : {}),
  };
}
