// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 会话工作区**严格边界**守卫 + 越界错误文案（2026-11-17，T3 复杂度清理 stage 6）。
 *
 * 从 `ToolExecutionService` **原样搬出**：
 *  - `formatWorkspaceEscapeError` / `formatWorkspaceInvalidError` / `formatWorkspaceRootsHint`
 *    三个纯文案函数（服务侧保留同名 re-export，既有导入路径不变）；
 *  - `_executeInternal` 的「工作区严格边界」整段：越界判定（单根 / 多根灰度）、
 *    工作区失效 ⇒ fail-fast 环境阻塞、首次越界 ⇒ 提交「允许访问该目录」审批卡、
 *    以及 `permission_denied / workspace_escape / workspace_escape_pending_approval` 分型。
 *
 * 语义约定（与搬出前一致）：返回非 `null` ⇒ 调用方**立即返回**（拒绝执行）；
 * `null` ⇒ 未越界或未启用严格边界，继续执行。
 */
import { getLogger } from '@openliri/infra/monitoring';
import { feature } from '@openliri/kernel';
import {
  findWorkspaceEscape,
  findWorkspaceEscapeInRoots,
} from '@openliri/infra/utils/toolContract';
import type { ToolFailureKind } from '@modules/session/types/tool.js';
import type { ToolResult } from '@modules/session/types/tool.js';
import { isUsableDirectory } from './toolCwdScope';

const logger = getLogger('chat:toolExecution');

/**
 * FIX-10（2026-10-27）：会话工作区**严格边界**越界时的错误文案（纯函数，便于单测）。
 *
 * 原文案只说"不在会话工作区内"，不给**允许根** ⇒ 模型继续猜绝对路径
 * （真机 6 次 `glob`/`file_read` 指向仓库根，被拒后反复重试）。
 * 现明确给出可访问根，便于一次性改写路径。
 */
export function formatWorkspaceEscapeError(params: {
  argKey: string;
  argValue: string;
  workspace: string;
  /** B1（2026-10-30）：多根模式下的**全部**可访问根（缺省 = 单根 `workspace`） */
  roots?: readonly string[];
  /** B1（2026-10-30）：是否已向用户提交「允许访问该目录」的审批申请 */
  approvalRequested?: boolean;
}): string {
  const base =
    `路径越界：${params.argKey}=${params.argValue} 不在会话工作区内；` +
    `本会话可访问根：${params.workspace}；` +
    '请改用该根下的相对路径，或改用会话内已有的工作区文件。';
  // 以下为 B1 新增（`FEATURE_WORKSPACE_MULTI_ROOT` 关闭时不传 ⇒ 文案与改造前逐字一致）
  const extraRoots = (params.roots ?? []).filter((r) => r !== params.workspace);
  if (extraRoots.length === 0 && params.approvalRequested === undefined) {
    return base;
  }
  const rootsHint =
    extraRoots.length > 0 ? `（另含：${extraRoots.join('、')}）` : '';
  const applyHint =
    params.approvalRequested === true
      ? '\n已向用户提交「允许本会话访问该目录」的审批申请：批准后本次调用会被自动重试，无需你重复申请。'
      : params.approvalRequested === false
        ? '\n如需访问该目录，请在回复中说明用途并向用户申请（当前工作区仅含上述根）。'
        : '';
  return (
    base.replace('本会话可访问根：', `本会话可访问根${rootsHint}：`) + applyHint
  );
}

/**
 * P0-1（2026-11-05）：**会话工作区已失效**时的错误文案（纯函数，便于单测）。
 *
 * 现场：会话工作区是一个已被删除的 worktree（`…\worktrees\alwayson-…-1793846360099`），
 * 严格边界仍然生效 ⇒ 任何指向真实仓库的路径都判「越界」，而越界文案还建议
 * 「改用该根下的相对路径」——指向一个**不存在的根**。模型只能反复重试：
 * 实测 236 次越界 + 20 次 `spawn ENOENT`（`cmd.exe` 被误判为缺失）。
 */
export function formatWorkspaceInvalidError(params: {
  roots: readonly string[];
}): string {
  const list = params.roots.length > 0 ? params.roots.join('、') : '(未知)';
  return (
    `会话工作区已失效：${list} 不存在或不是目录；` +
    '工具无法在该根下执行（子进程会拿到无效 cwd，表现为 ENOENT，易被误判为系统命令缺失）。' +
    '请不要继续猜测其它路径 —— 请向用户说明「工作区已失效」，' +
    '并请其重新定位项目工作区（或在项目管理中重新生成工作区）后再继续。'
  );
}

/**
 * 形态④（2026-11-06 裁定）：**不放宽路径根**，只把「本轮可访问根」显式告诉模型。
 *
 * 背景：长程/自主任务的会话 cwd 是隔离工作区（`~/.pyapp/workspaces/…`），模型却按
 * 真实项目根读写 ⇒ 权限层按工作区边界判 `ask`，模型只看到「需要审批」、不知道
 * 可用根是谁，于是反复重试（与 FIX-10 同源：缺的是**允许根**，不是判定本身）。
 *
 * 为什么选「告知根」而不是「把项目根并入边界」：后者会让自主任务直接写真实项目根，
 * 削弱隔离（CD07 安全域一票否决）；且审核口径与 FIX-10 的越界文案保持一致。
 *
 * @param roots 本轮可访问根（空 ⇒ 返回空串，不添加噪声）
 */
export function formatWorkspaceRootsHint(roots: readonly string[]): string {
  if (roots.length === 0) return '';
  return (
    `（本会话可访问根：${roots.join(' | ')}；` +
    '若你使用的是真实项目路径，请改用这些根内的路径）'
  );
}

export interface WorkspaceBoundaryDeps {
  isSessionWorkspaceStrict?(sessionId?: string): boolean;
  getSessionWorkspaceRoots?(sessionId?: string): string[] | undefined;
  /** 首次越界时提交「允许本会话访问该目录」审批卡（返回是否已有/已建卡） */
  requestWorkspaceScopeApproval(
    sessionId: string | undefined,
    targetPath: string
  ): Promise<boolean>;
}

export interface WorkspaceBoundaryParams {
  toolCall: { id: string; name: string; sessionId?: string };
  args: Record<string, unknown>;
  sessionWorkspacePath: string | undefined;
  deps: WorkspaceBoundaryDeps;
}

export async function guardWorkspaceBoundary(
  params: WorkspaceBoundaryParams
): Promise<ToolResult | null> {
  const { toolCall, args, sessionWorkspacePath, deps } = params;

  // U-02 v2 / P3（2026-10-20）：**仅当会话显式声明工作区严格边界**（AlwaysOn 隔离轮）
  // 才做越界拒绝 —— 普通项目会话的绝对路径语义保持历史行为（零变更）。
  if (
    !sessionWorkspacePath ||
    deps.isSessionWorkspaceStrict?.(toolCall.sessionId) !== true
  ) {
    return null;
  }

  // B1（2026-10-30，issue #35）：灰度开关关闭 ⇒ 单根 + 原分类（逐字不变）
  const multiRootEnabled = feature('WORKSPACE_MULTI_ROOT');
  const roots = multiRootEnabled
    ? (deps.getSessionWorkspaceRoots?.(toolCall.sessionId) ?? [])
    : [];
  const escape =
    roots.length > 0
      ? findWorkspaceEscapeInRoots(roots, args)
      : findWorkspaceEscape(sessionWorkspacePath, args);
  if (!escape) return null;

  // P0-1（2026-11-05）：**工作区已失效** ⇒ 越界文案会指向一个死根
  //（"请改用该根下的相对路径"），模型只能反复重试（实测 236 次越界 + 20 次 ENOENT）。
  // 只要**没有任何可访问根可用**，就改为 fail-fast 的环境阻塞错误（env_unavailable）：
  // 计入 environment_blocked（2 轮熔断），并在可见错误里要求重新定位工作区。
  const candidateRoots =
    multiRootEnabled && roots.length > 0 ? roots : [sessionWorkspacePath];
  if (candidateRoots.every((root) => !isUsableDirectory(root))) {
    logger.warn('会话工作区已失效，越界调用改为 fail-fast（严格边界）', {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      sessionId: toolCall.sessionId,
      roots: candidateRoots,
    });
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: null,
      error: formatWorkspaceInvalidError({ roots: candidateRoots }),
      failureKind: 'env_unavailable' as ToolFailureKind,
    };
  }

  // 首次越界 ⇒ 提交「允许本会话访问该目录」审批卡（同一目标只建一张）。
  // 提交失败不影响拒绝：按"未申请"如实告知模型（CS03-002 不静默）。
  let approvalRequested: boolean | undefined;
  if (multiRootEnabled) {
    approvalRequested = await deps.requestWorkspaceScopeApproval(
      toolCall.sessionId,
      escape.resolved
    );
  }
  logger.warn('工具路径越界，已拒绝执行（会话工作区严格边界）', {
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    sessionId: toolCall.sessionId,
    argKey: escape.key,
    argValue: escape.value,
    resolved: escape.resolved,
    via: escape.via,
    workspace: sessionWorkspacePath,
    ...(multiRootEnabled ? { multiRootEnabled, roots, approvalRequested } : {}),
  });
  return {
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    result: null,
    // FIX-10（2026-10-27）：两个缺口一起补 ——
    // ① 原错误只说"不在工作区内"，不给**允许根**：模型会继续猜绝对路径
    //    （真机 6 次 glob/file_read 指向仓库根，全部被拒后反复重试）；
    // ② 未带 `failureKind` ⇒ 被计入 invalid 预算（3 轮）而非环境阻塞（2 轮），
    //    与 FIX-5 同源。
    error: formatWorkspaceEscapeError({
      argKey: escape.key,
      argValue: escape.value,
      workspace: sessionWorkspacePath,
      ...(multiRootEnabled ? { roots, approvalRequested } : {}),
    }),
    // B1（2026-10-30）：多根模式下越界是**可恢复**的（批准加根即可重发）
    // ⇒ 记 `workspace_escape`（不计入 environment_blocked 的 2 轮熔断）；
    // 开关关闭时保持既有 `permission_denied`（零行为变更）。
    // 2026-10-31（台账 §16）：**已提交审批**时改记 `workspace_escape_pending_approval`
    // —— 该态在熔断分型中为中性（同 aborted），否则「等用户批准」会烧完
    // `consecutiveInvalidTurns`（3 轮）⇒ 审批落地时已无轮次可用。
    failureKind: (multiRootEnabled
      ? approvalRequested === true
        ? 'workspace_escape_pending_approval'
        : 'workspace_escape'
      : 'permission_denied') as ToolFailureKind,
  };
}
