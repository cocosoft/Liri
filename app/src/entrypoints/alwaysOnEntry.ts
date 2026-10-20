/**
 * AlwaysOn 入口接线（U-02，2026-10-20 最小可用自主执行 v1）。
 *
 * 职责：把**宿主能力**（ChatManager / ProjectStore / 报告目录）装配成桥接器依赖，
 * 再交给 `bootstrapAlwaysOn()`。放在 `entrypoints/` 是为了守住 R00-001：
 * `tasks` 层不直接依赖 `chat` / `workspace` 的实现细节。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { feature, resolveDataDir } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { WorkItemStore, createProjectStore } from '@modules/workspace';

import {
  AlwaysOnManager,
  bootstrapAlwaysOn,
  createAlwaysOnBridge,
  type AlwaysOnProject,
} from '@modules/tasks';

const logger = getLogger('entrypoints:alwayson');

export interface AlwaysOnStartResult {
  registered: string[];
  started: boolean;
  teardown: () => void;
}

/**
 * 启动 AlwaysOn（由 `main.ts` 的 `wrapInit('AlwaysOn', …)` 调用）。
 *
 * - `feature('ALWAYSON')` 关闭 ⇒ 直接返回，**不建 manager、不读项目、不启动定时器**；
 * - 开启 ⇒ 从 `ProjectStore` 读取项目（仅取有 `sandboxPath` 者），逐项目注册并注入实现。
 */
export async function startAlwaysOn(): Promise<AlwaysOnStartResult> {
  if (!feature('ALWAYSON')) {
    logger.info('AlwaysOn 未启用（FEATURE_ALWAYSON=false）');
    return { registered: [], started: false, teardown: () => {} };
  }

  const chatManager = getCoreAPI().getChatManager();
  const dataDir = resolveDataDir();
  const projectStore = createProjectStore(dataDir, new WorkItemStore(dataDir));
  const projects: AlwaysOnProject[] = projectStore
    .list('default')
    .filter((project) => Boolean(project.sandboxPath))
    .map((project) => ({
      id: project.id,
      name: project.name,
      path: project.sandboxPath as string,
    }));

  const reportDir = join(dataDir, 'alwayson', 'reports');
  const manager = new AlwaysOnManager();

  const result = bootstrapAlwaysOn({
    enabled: true,
    projects,
    manager,
    createBridge: (project, limits) =>
      createAlwaysOnBridge({
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        limits,
        createSession: async ({ id, name }) => {
          const session = await chatManager.createSession({
            title: `AlwaysOn · ${name}`,
            description: `AlwaysOn 自主执行会话（项目 ${id}）`,
            tags: ['alwayson'],
          });
          return session.id;
        },
        sendPrompt: async (sessionId, prompt, hooks) => {
          const message = await chatManager.sendMessage(prompt, {
            sessionId,
            priority: 'background',
            _fromInternal: true,
            _fromInternalSource: 'alwayson',
            onToolCall: (phase, toolName) =>
              hooks.onToolCall?.(phase, toolName),
            onUsage: (usage) => hooks.onUsage?.(usage),
          });
          return typeof message.content === 'string' ? message.content : '';
        },
        writeReport: async (planId, markdown) => {
          mkdirSync(reportDir, { recursive: true });
          const file = join(reportDir, `${planId}.md`);
          writeFileSync(file, markdown, 'utf8');
          return file;
        },
      }),
  });

  logger.info('AlwaysOn 接线完成', {
    registered: result.registered.length,
    started: result.started,
  });
  return result;
}
