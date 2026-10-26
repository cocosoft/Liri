/**
 * 工具执行 cwd 的身份分治（多租户 P3 · 资源隔离）
 *
 * 背景：`ToolExecutionService` 原先把工具 cwd 定为
 * `会话工作区路径 ?? resolveProjectRoot()`。两者都是**进程级**的：
 *   - `metadata.workspacePath` 可由 HTTP 请求体写入，且执行侧不做归属校验；
 *   - `resolveProjectRoot()` 恒为宿主机的项目根（`process.cwd()` / `LIRI_PROJECT_DIR`）。
 * ⇒ 多用户并发时，远端租户的工具会落在宿主目录或别人的工作区里。
 *
 * 口径（与 P1 存储分区、P2 事件路由同一条 fail-closed 原则）：
 *   - 本地身份（桌面 / CLI / cron / 通道 / 后台）⇒ 行为**逐字不变**；
 *   - 已认证身份 ⇒ 只认 `<scoped>/workspace` 之内的会话工作区；越界一律**忽略并回退**
 *     到该身份的 workspace 根，绝不使用进程级项目根。
 *
 * 为什么放在 `chat/services` 而不是 `core/paths`：`core/paths` 只做路径计算（无副作用，
 * 也不该知道"cwd 要怎么兜底"这一策略）；目录创建属于执行侧职责。
 */
import { existsSync, mkdirSync } from 'fs';
import { isAbsolute } from 'path';
import { getLogger } from '@modules/monitoring';
import {
  isPathWithin,
  resolveProjectRoot,
  resolveScopedWorkspaceRoot,
} from '@openliri/kernel/paths';
import {
  getRequestPrincipal,
  isLocalPrincipal,
} from '@openliri/kernel/identity/requestScope';
import type { Principal } from '@openliri/kernel/identity/principal';

const logger = getLogger('chat:services:toolCwdScope');

export interface ToolCwdDecision {
  /** 最终用于工具 `options.cwd` 的目录 */
  cwd: string;
  /** 会话工作区被拒（越出该身份根）⇒ 调用方可据此留痕 */
  rejectedSessionWorkspace: boolean;
}

/**
 * LRO-06（2026-10-26 真机实测）／D4 后半：由**会话元数据**解析"会话工作区"。
 *
 * 实测缺口：项目模块会话的 `metadata` 只有 `projectId`、**没有 `workspacePath`**，
 * 于是 `resolveToolCwd` 回落到 `resolveProjectRoot()`（= **代码仓根**）—— 同会话 188 次
 * 无 cwd 的 bash 全部落在仓库根，产物散落且 0 件进项目目录。
 *
 * 解析优先级（**只认绝对路径**，相对值/项目名一律忽略）：
 *   1. `metadata.workspacePath`（客户端/用户显式指定，历史语义不变）；
 *   2. `metadata.projectId` 对应项目的 `project.json#sandboxPath`（既有 ProjectStore 提供）；
 *   3. `undefined` ⇒ 调用方回落 `resolveProjectRoot()`（无项目会话保持旧行为）。
 *
 * 纯函数 + 回调注入：便于单测，也避免在 `chat/services` 里静态依赖 `workspace/ProjectStore`
 * （会把该模块拉进启动图）。
 */
export function resolveSessionWorkspacePath(input: {
  metadata: Record<string, unknown> | undefined;
  /** `projectId → sandboxPath`（由调用方延迟加载 ProjectStore 提供） */
  getProjectSandboxPath: (projectId: string) => string | undefined;
}): string | undefined {
  const workspacePath = input.metadata?.workspacePath;
  // P2-2 收尾：仅接受绝对路径（存量会话的 workspacePath 可能是修复前的项目名，非路径）
  if (typeof workspacePath === 'string' && isAbsolute(workspacePath)) {
    return workspacePath;
  }

  const projectId = input.metadata?.projectId;
  if (typeof projectId === 'string' && projectId) {
    const sandboxPath = input.getProjectSandboxPath(projectId);
    if (typeof sandboxPath === 'string' && isAbsolute(sandboxPath)) {
      return sandboxPath;
    }
  }

  return undefined;
}

/**
 * 解析一次工具执行的 cwd。
 *
 * @param sessionWorkspacePath 会话元数据里的工作区（可能来自请求体，未经验证）
 * @param principal 当前请求身份（缺省取 ALS）
 */
export function resolveToolCwd(
  sessionWorkspacePath: string | null | undefined,
  principal: Principal = getRequestPrincipal()
): ToolCwdDecision {
  if (isLocalPrincipal(principal)) {
    return {
      cwd: sessionWorkspacePath ?? resolveProjectRoot(),
      rejectedSessionWorkspace: false,
    };
  }

  const root = resolveScopedWorkspaceRoot(principal);
  if (sessionWorkspacePath && isPathWithin(root, sessionWorkspacePath)) {
    return { cwd: sessionWorkspacePath, rejectedSessionWorkspace: false };
  }

  // 租户根按需创建：bash / grep / glob 都以 cwd 启动，目录不存在会直接失败。
  // 只在"将要回退到租户根"时创建，避免每次工具调用都碰文件系统。
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }

  if (sessionWorkspacePath) {
    logger.warning('会话工作区越出租户根，已忽略并使用租户工作区', {
      principalKey: `${principal.tenantId}:${principal.userId}`,
      sessionWorkspacePath,
      root,
    });
  }

  return { cwd: root, rejectedSessionWorkspace: Boolean(sessionWorkspacePath) };
}
