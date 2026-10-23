/**
 * 权限上下文接口
 */
import type { SandboxExecutionSignal } from '@modules/utils/toolContract/Tool';

export interface PermissionContext {
  /**
   * 会话ID（可选）
   */
  sessionId?: string;

  /**
   * 用户ID（可选）
   */
  userId?: string;

  /**
   * 工具名称
   */
  toolName: string;

  /**
   * 用户角色（可选）
   */
  userRole?: string;

  /**
   * 客户端IP（可选）
   */
  clientIp?: string;

  /**
   * 工具输入
   */
  input: Record<string, unknown>;

  /**
   * 元数据（可选）
   */
  metadata?: Record<string, unknown>;

  /**
   * PR-3（2026-10-23）：**会话级审批模式**（会话元数据 `approvalMode`，默认 `ask`）。
   *
   * - `ask`：每次按风险默认档走人工审批（改造前行为）；
   * - `auto-local`：**风险默认档**里额外自动放行「本地写 + 路径全在会话工作区内」，
   *   其余（SHELL / EXTERNAL / UNDECLARED / 越界写）仍人工。
   *
   * 仅在 `FEATURE_SESSION_AUTO_LOCAL` 开启时生效（默认关 ⇒ 零行为变更）。
   */
  approvalMode?: 'ask' | 'auto-local';

  /**
   * PR-3：会话工作区路径（`auto-local` 的写操作边界；缺省 ⇒ 不自动放行写）。
   */
  workspacePath?: string;

  /**
   * PR-3a（2026-10-23）：本次执行的**沙箱上下文**（由执行入口注入）。
   *
   * 当前只用于审批卡留证（`sandboxMode` / `sandboxPermissionLevel`），
   * **不参与** allow / ask / deny 判定（豁免判定在 PR-3b 统一落地）。
   * 缺省 ⇒ 视为"未沙箱"（fail-closed）。
   */
  sandbox?: SandboxExecutionSignal;
}

/**
 * 创建权限上下文
 * @param params 上下文参数
 * @returns 权限上下文对象
 */
export function createPermissionContext(params: {
  toolName: string;
  input: Record<string, unknown>;
  sessionId?: string;
  userId?: string;
  /** 请求级角色（多租户 P0 阶段 2）：缺省 ⇒ `PermissionManager` 回退进程级角色 */
  userRole?: string;
  metadata?: Record<string, unknown>;
  /** PR-3：会话级审批模式（缺省 `ask`） */
  approvalMode?: 'ask' | 'auto-local';
  /** PR-3：会话工作区路径（`auto-local` 的写边界） */
  workspacePath?: string;
  /** PR-3a：本次执行的沙箱上下文（仅供审批卡留证，不改判定） */
  sandbox?: SandboxExecutionSignal;
}): PermissionContext {
  return {
    sessionId: params.sessionId,
    userId: params.userId,
    toolName: params.toolName,
    userRole: params.userRole,
    input: params.input,
    metadata: params.metadata,
    approvalMode: params.approvalMode,
    workspacePath: params.workspacePath,
    sandbox: params.sandbox,
  };
}

/**
 * 扩展权限上下文
 * @param context 原始上下文
 * @param extensions 扩展内容
 * @returns 扩展后的上下文
 */
export function extendPermissionContext(
  context: PermissionContext,
  extensions: Partial<PermissionContext>
): PermissionContext {
  return {
    ...context,
    ...extensions,
    input: {
      ...context.input,
      ...(extensions.input || {}),
    },
    metadata: {
      ...context.metadata,
      ...(extensions.metadata || {}),
    },
  };
}
