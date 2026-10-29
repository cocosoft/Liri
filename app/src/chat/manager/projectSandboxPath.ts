// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * projectSandboxPath — 「projectId → project.json#sandboxPath」解析外移
 * （issue #17 · D6，2026-10-29）
 *
 * 迁出来源：`ChatManager._getProjectSandboxPath` 的方法体（原 2377–2409，约 33 行）。
 *
 * LRO-06 语义（与迁移前逐字一致）：
 * - **延迟 `require`**：`workspace/ProjectStore` 不进启动图（`lint:startup-graph` 棘轮只减不增），
 *   且只有"项目会话 + 没有显式 workspacePath"这一条分支才会触发；
 * - store 实例缓存在**宿主**（实例级，首次使用惰性创建）；
 * - 解析失败 ⇒ 回落历史行为（`resolveProjectRoot`），只 warn、不阻塞工具执行。
 */

import { getLogger } from '@modules/monitoring';
import { resolveDataDir } from '@modules/environment';

const logger = getLogger('chat:manager');

/** `ProjectStore` 的最小取用面 */
export interface ProjectStoreLike {
  get(id: string): { sandboxPath?: string } | undefined;
}

export interface ProjectSandboxPathPorts {
  /** 宿主持有的 store 缓存（实例级；首次使用时惰性创建） */
  cacheRef: { current?: ProjectStoreLike };
}

export function getProjectSandboxPath(
  ports: ProjectSandboxPathPorts,
  projectId: string
): string | undefined {
  try {
    const { createProjectStore } =
      require('../../workspace/ProjectStore.js') as {
        createProjectStore: (
          dataDir: string,
          itemStore: unknown
        ) => ProjectStoreLike;
      };
    const { WorkItemStore } = require('../../workspace/WorkItemStore.js') as {
      WorkItemStore: new (dataDir: string) => unknown;
    };
    if (!ports.cacheRef.current) {
      const dataDir = resolveDataDir();
      ports.cacheRef.current = createProjectStore(
        dataDir,
        new WorkItemStore(dataDir)
      );
    }
    const sandboxPath = ports.cacheRef.current.get(projectId)?.sandboxPath;
    return typeof sandboxPath === 'string' && sandboxPath
      ? sandboxPath
      : undefined;
  } catch (error) {
    // @ignore-catch — 项目解析失败 ⇒ 回落历史行为（resolveProjectRoot），不阻塞工具执行
    logger.warning('解析项目 sandboxPath 失败，工具 cwd 回落项目根', {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
