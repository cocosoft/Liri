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
