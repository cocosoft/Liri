// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * workspacePath — 会话工作区路径解析（issue #19 · Cut H，2026-10-29）
 *
 * 迁出来源：`ChatManager.getSessionWorkspacePath`（原 19 行）。
 *
 * LRO-06 / D4 后半（2026-10-26 真机实测）：项目会话的 metadata 只有 `projectId`、
 * 没有 `workspacePath` ⇒ 此前工具 cwd 回落**代码仓根**。现由 `projectId` 解析
 * `project.json#sandboxPath`（用户项目目录），并**回写** `metadata.workspacePath`，
 * 使客户端 `currentSession.workspacePath` 与服务端同一口径。
 *
 * 行为不变：`projectId` 派生值才回写（已有绝对 `workspacePath` 时不覆盖）；
 * store 缓存仍由宿主持有（实例级），以引用传入。
 */

import type { ChatSession } from '@modules/session/types/session';
// P0-2（2026-11-04）：根列表合并口径下沉 infra（AlwaysOn 入口同用，不再经 chat 转发）
import { mergeWorkspaceRoots } from '@openliri/infra/utils/toolContract/workspaceRoots';
import {
  isCompiledRuntime,
  resolveProjectRoot,
  resolveSessionWorkspaceDir,
} from '@openliri/infra/environment';
import { resolveSessionWorkspacePath } from '../services/toolCwdScope';
import {
  getProjectSandboxPath,
  type ProjectStoreLike,
} from './projectSandboxPath';

export interface WorkspacePathHost {
  /** 会话缓存读取（宿主 `_chatSessions.get`） */
  getSession: (sessionId: string) => ChatSession | undefined;
  /** `ProjectStore` 实例缓存（延迟 `require`；实例级生命周期归宿主） */
  projectSandboxStoreRef: { current?: ProjectStoreLike };
}

export function getSessionWorkspacePath(
  host: WorkspacePathHost,
  sessionId?: string
): string | undefined {
  if (!sessionId) return undefined;
  const session = host.getSession(sessionId);
  const metadata = session?.metadata as Record<string, unknown> | undefined;
  const resolved = resolveSessionWorkspacePath({
    metadata,
    getProjectSandboxPath: (projectId) =>
      getProjectSandboxPath(
        { cacheRef: host.projectSandboxStoreRef },
        projectId
      ),
  });
  // 由 projectId 派生（而非客户端显式传入）时回写元数据：本进程内后续读取与
  // 会话落盘/列表接口都拿到同一值；已有绝对 workspacePath 时不覆盖。
  if (resolved && metadata && !metadata.workspacePath) {
    metadata.workspacePath = resolved;
  }
  return resolved;
}

/**
 * 装配期注册的宿主（`facadeWiring` 单点注册，2026-11-10）。
 *
 * 供**非构造期装配面**（系统提示词组装经 `ChatPromptAssemblyDeps` 的缺省注入）复用同一
 * 解析实现 —— 既不新增第四份内联闭包（CS01），也不让 `ChatManager` 继续增行（R04-001）。
 */
let registeredHost: WorkspacePathHost | undefined;

export function registerWorkspacePathHost(host: WorkspacePathHost): void {
  registeredHost = host;
}

/**
 * 裸会话（无显式工作区、无 projectId）的相对路径基准（2026-11-10）。
 *
 * 与 `resolveToolCwd` 的"无会话工作区"分支**同口径**，但**只算路径、不建目录** ——
 * 提示词组装不应有文件系统副作用：
 *  - 编译版：工具 cwd = `<data>/workspace/sessions/<sessionId>`；
 *  - 开发版：工具 cwd 回落 `resolveProjectRoot()`（代码仓根，便于调试）。
 */
function bareSessionWorkspace(sessionId: string): string {
  return isCompiledRuntime()
    ? resolveSessionWorkspaceDir(sessionId)
    : resolveProjectRoot();
}

/** 已注册宿主上的会话工作区；未注册 / 会话未加载 ⇒ `undefined`（调用方据此不注入） */
export function resolveRegisteredSessionWorkspace(
  sessionId?: string
): string | undefined {
  if (!registeredHost || !sessionId) return undefined;
  // 会话未加载 ⇒ 不猜（磁盘上可能有显式工作区，等加载后再给）
  if (!registeredHost.getSession(sessionId)) return undefined;
  return (
    getSessionWorkspacePath(registeredHost, sessionId) ??
    bareSessionWorkspace(sessionId)
  );
}

/**
 * P1（2026-11-04，方案 §3.6）：会话**工作区根列表**（`resolveRoots` 的唯一实现）。
 *
 * - 首根 = {@link getSessionWorkspacePath}（`workspacePath` 或 `projectId → sandboxPath`，
 *   并沿用其回写语义 ⇒ 与工具 cwd 同一事实来源）；
 * - 其余 = `metadata.workspaceRoots`（用户批准越界申请时追加，写入时已父子折叠）。
 *
 * 原实现（`ChatManager.getSessionWorkspaceRoots`）只读 `metadata.workspacePath`，
 * 对"仅有 projectId 的项目会话"会漏掉主根 ⇒ 权限层与执行前判定各自回落单根，口径不一致。
 */
export function getSessionWorkspaceRoots(
  host: WorkspacePathHost,
  sessionId?: string
): string[] {
  if (!sessionId) return [];
  const primary = getSessionWorkspacePath(host, sessionId);
  const metadata = host.getSession(sessionId)?.metadata as
    | Record<string, unknown>
    | undefined;
  return mergeWorkspaceRoots(primary, metadata?.workspaceRoots);
}
