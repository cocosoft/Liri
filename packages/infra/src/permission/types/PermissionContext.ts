/**
 * 权限上下文接口
 */
import type { SandboxExecutionSignal } from '@openliri/infra/utils/toolContract/Tool';
import type { PermissionMode } from '../PermissionMode';

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
   * P1（2026-11-04）：**会话级权限模式**（会话元数据 `permission_mode`）。
   *
   * 优先级：本字段（会话）> `PermissionManager` 的进程默认档（`PERMISSION_MODE` 环境变量）。
   * 缺省 ⇒ 用进程默认档（改造前行为）。由执行入口按 `sessionId` 取出后注入，
   * 而不是调用 `setMode()` 改全局单例 —— 多会话并发时后者会串档。
   */
  permissionMode?: PermissionMode;

  /**
   * PR-3：会话工作区路径（`auto-local` 的写操作边界；缺省 ⇒ 不自动放行写）。
   */
  workspacePath?: string;

  /**
   * P1（2026-11-04，方案 §3.6）：会话的**工作区根列表**（首根 = 主工作区）。
   *
   * 由执行入口按 `sessionId` 统一解析后注入（`resolveRoots`），消费方只有
   * `auto-local` 的边界判定：任一根之内即视为在界内（`findWorkspaceEscapeInRoots`）。
   * 缺省 ⇒ 回落到单根 `workspacePath`（与改造前逐字一致）。
   */
  workspaceRoots?: string[];

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
  /** P1（2026-11-04）：会话级权限模式（缺省 ⇒ 用进程默认档） */
  permissionMode?: PermissionMode;
  /** PR-3：会话工作区路径（`auto-local` 的写边界） */
  workspacePath?: string;
  /** P1（2026-11-04）：会话工作区根列表（缺省 ⇒ 回落单根 `workspacePath`） */
  workspaceRoots?: string[];
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
    permissionMode: params.permissionMode,
    workspacePath: params.workspacePath,
    workspaceRoots: params.workspaceRoots,
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
