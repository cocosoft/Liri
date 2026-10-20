/**
 * AlwaysOn 入口接线（U-02，2026-10-20 最小可用自主执行 v1.1）。
 *
 * 职责：把**宿主能力**（ChatManager / ProjectStore / 报告目录 / 主动通知）装配成桥接器依赖，
 * 再交给 `bootstrapAlwaysOn()`。放在 `entrypoints/` 是为了守住 R00-001：
 * `tasks` 层不直接依赖 `chat` / `workspace` / `proactive` 的实现细节。
 *
 * v1.1（处理方案 §9 偏差）：
 * - 会话**跨重启复用**（`alwayson/sessions.json` projectId → sessionId）；
 * - 超时**真正中止**（`streamMessage` + `AbortSignal`，不再只记失败）；
 * - 工具面收窄（discovery `taskType='messaging'` 只读面 / execution `taskType='coding'`）；
 * - 报告**主动通知**（复用主动队列 + 同一门禁与去重口径）；
 * - 项目来源覆盖**所有工作空间**（`listAll()` + `default`，按项目 id 去重）。
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { DEFAULT_TIMEZONE, MS_PER_DAY } from '@modules/constants';
import { feature, resolveDataDir } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { WorkItemStore, createProjectStore } from '@modules/workspace';
import {
  GitWorktreeProvider,
  generateWorkspaceDiff,
  type WorkspaceHandle,
} from '@modules/workspaces';

import {
  AlwaysOnManager,
  bootstrapAlwaysOn,
  createAlwaysOnBridge,
  type AlwaysOnBridgeDeps,
  type AlwaysOnProject,
} from '@modules/tasks';
import { getActiveProactiveQueue } from '../proactive/ProactiveRuntime';
import { resolveProactiveGatePrefs } from '../proactive/ProactiveCronProducer';
import { evaluateProactiveNotification } from '../proactive/ProactiveNotificationGate';
import type { ProactiveMessagePayload } from '../proactive/types';
import { listAll } from '../workspaces/WorkspaceRegistry';

const logger = getLogger('entrypoints:alwayson');

export interface AlwaysOnStartResult {
  registered: string[];
  started: boolean;
  teardown: () => void;
}

/** 读取 `alwayson/sessions.json`（损坏/缺失 ⇒ 空表，不阻断启动） */
function readSessionMap(file: string): Record<string, string> {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return raw !== null && typeof raw === 'object'
      ? (raw as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

/** 汇总所有工作空间的项目（`default` + 注册表；按项目 id 去重，只取有 sandboxPath 者） */
async function collectProjects(
  projectStore: ReturnType<typeof createProjectStore>
): Promise<AlwaysOnProject[]> {
  const workspaceIds = new Set<string>(['default']);
  try {
    for (const name of Object.keys(await listAll())) workspaceIds.add(name);
  } catch {
    // 注册表不可读 ⇒ 仅 default（不阻断启动）
  }

  const byId = new Map<string, AlwaysOnProject>();
  for (const workspaceId of workspaceIds) {
    for (const project of projectStore.list(workspaceId)) {
      if (!project.sandboxPath || byId.has(project.id)) continue;
      byId.set(project.id, {
        id: project.id,
        name: project.name,
        path: project.sandboxPath,
      });
    }
  }
  return [...byId.values()];
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
  const projects = await collectProjects(projectStore);

  const reportDir = join(dataDir, 'alwayson', 'reports');
  const sessionFile = join(dataDir, 'alwayson', 'sessions.json');
  const manager = new AlwaysOnManager();
  /** 本轮隔离区句柄（runId → provider + handle）；worktree 的 Map 在 provider 内部，必须复用同一实例 */
  const activeRuns = new Map<
    string,
    { provider: GitWorktreeProvider; handle: WorkspaceHandle }
  >();

  /**
   * 准备本轮隔离区（v2 P2）。
   *
   * 只走 `GitWorktreeProvider`（`refuseDirty` 默认 true）：
   * 非 git / 工作区有未提交改动 ⇒ 返回 `skippedReason`，**不退回直连项目目录**
   * （方案 §10.7 裁定 B：宁可跳过，不可悄悄改用户工作区）。
   */
  const prepareWorkspace: AlwaysOnBridgeDeps['prepareWorkspace'] = async ({
    projectPath,
    runId,
  }) => {
    const provider = new GitWorktreeProvider({
      projectRoot: projectPath,
      refuseDirty: true,
    });
    if (!(await provider.isApplicable(projectPath))) {
      return { skippedReason: 'not_git_repo_or_dirty' };
    }
    try {
      const handle = await provider.prepare({
        projectRoot: projectPath,
        runId,
      });
      activeRuns.set(runId, { provider, handle });
      return {
        workspace: {
          cwd: handle.cwd,
          strategy: handle.strategy,
          ref: { runId },
        },
      };
    } catch (error) {
      return {
        skippedReason: `prepare_failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  };

  /**
   * 收尾（v2 P2/P5）：把隔离区改动**导出为补丁**（不自动 apply），再清理 worktree。
   *
   * 补丁落盘失败 / diff 超长被截断 ⇒ `keep: true` 保留 worktree，避免成果丢失。
   */
  const finishWorkspace: AlwaysOnBridgeDeps['finishWorkspace'] = async (
    workspace
  ) => {
    const runId =
      typeof workspace.ref.runId === 'string' ? workspace.ref.runId : '';
    const active = runId ? activeRuns.get(runId) : undefined;
    if (!active) {
      return { diffBytes: 0, error: 'workspace-handle-missing' };
    }
    activeRuns.delete(runId);

    const diff = await generateWorkspaceDiff(active.handle.cwd);
    let patchPath: string | undefined;
    let keep = false;
    let error: string | undefined;

    if (diff.diff.trim().length > 0) {
      if (diff.truncated) {
        // 截断的补丁无法 `git apply` ⇒ 不导出，保留 worktree 交人工处理
        keep = true;
        error = 'diff-truncated: 补丁超长已截断，未导出（worktree 已保留）';
      } else {
        try {
          mkdirSync(reportDir, { recursive: true });
          patchPath = join(reportDir, `${runId}.patch`);
          writeFileSync(patchPath, diff.diff, 'utf8');
        } catch (e) {
          keep = true;
          error = `patch-write-failed: ${
            e instanceof Error ? e.message : String(e)
          }`;
        }
      }
    }

    try {
      await active.provider.dispose(active.handle, { keep });
    } catch (e) {
      error =
        error ??
        `dispose-failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    return {
      patchPath,
      diffBytes: diff.diff.length,
      kept: keep,
      error,
    };
  };

  /**
   * 把会话的工具 cwd 指向指定目录（v2 P1）。
   *
   * 工具执行侧读的是**内存会话**的 `metadata.workspacePath`
   * （`ChatManager.getSessionWorkspacePath`），存储侧用于跨重启 ⇒ 两处都更新。
   */
  const setSessionWorkspace: AlwaysOnBridgeDeps['setSessionWorkspace'] = async (
    sessionId,
    cwd
  ) => {
    const cached = await chatManager.loadSession(sessionId);
    if (cached) {
      cached.metadata = { ...(cached.metadata ?? {}), workspacePath: cwd };
      await chatManager.saveSession(cached);
      await chatManager.persistSessionMetadata(cached);
      return;
    }
    // 冷启动：会话尚未载入内存（`loadSession` 只读 Map）⇒ 改存储；
    // 首次 `streamMessage` 的 `getOrLoadSession` 会带回新 metadata。
    const gateway = chatManager.getSessionGateway();
    const stored = await gateway.getSession(sessionId);
    if (!stored) return;
    // `Session.metadata` 是强类型结构，直接写字面量属性会触发多余属性检查 ⇒ 经 Record 合并
    const patch: Record<string, unknown> = { workspacePath: cwd };
    stored.metadata = { ...(stored.metadata ?? {}), ...patch };
    await gateway.updateSession(stored);
  };

  const sendPrompt: AlwaysOnBridgeDeps['sendPrompt'] = async (
    sessionId,
    prompt,
    hooks,
    options
  ) => {
    // 用流式入口承载：只有它支持 AbortSignal（超时才能真正中止底层请求）
    const stream = chatManager.streamMessage(prompt, {
      sessionId,
      priority: 'background',
      _fromInternal: true,
      _fromInternalSource: 'alwayson',
      ...(options?.taskType
        ? { metadata: { taskType: options.taskType } }
        : {}),
      ...(options?.abortSignal ? { signal: options.abortSignal } : {}),
      onToolCall: (phase, toolName) => hooks.onToolCall?.(phase, toolName),
      onUsage: (usage) => hooks.onUsage?.(usage),
    });
    let step = await stream.next();
    while (!step.done) step = await stream.next();
    const content = step.value?.content;
    return typeof content === 'string' ? content : '';
  };

  const notifyReport: AlwaysOnBridgeDeps['notifyReport'] = async ({
    planId,
    title,
    body,
    success,
  }) => {
    const queue = getActiveProactiveQueue();
    if (!queue) return false;

    const now = Date.now();
    const payload: ProactiveMessagePayload = {
      id: `proactive-alwayson-${randomUUID()}`,
      kind: 'task_result',
      priority: success ? 'low' : 'normal',
      dedupeKey: `alwayson:${planId}`,
      title,
      body,
      target: { mode: 'local' },
      createdAt: now,
      expiresAt: now + MS_PER_DAY,
      source: { type: 'alwayson', ref: planId },
    };
    const recent = await queue.listRecentDelivered(now - MS_PER_DAY);
    const decision = evaluateProactiveNotification(payload, {
      now,
      timezone: DEFAULT_TIMEZONE,
      prefs: resolveProactiveGatePrefs(),
      recent,
    });
    if (decision.action === 'drop') return false;
    return queue.enqueue(
      payload,
      now,
      decision.action === 'queue' ? decision.retryAt : now
    );
  };

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
            // v2 P1：先把会话 cwd 固化到**目标项目**（discovery 读基准；
            // 执行阶段再按轮改到隔离区）—— 此前缺失 ⇒ 工具 cwd 落到 Liri 自身仓库。
            metadata: {
              workspacePath: project.path,
              workspaceId: id,
              alwayson: true,
            },
          });
          return session.id;
        },
        prepareWorkspace,
        finishWorkspace,
        setSessionWorkspace,
        loadSession: async (projectId) =>
          readSessionMap(sessionFile)[projectId],
        saveSession: async (projectId, sessionId) => {
          mkdirSync(dirname(sessionFile), { recursive: true });
          writeFileSync(
            sessionFile,
            `${JSON.stringify(
              { ...readSessionMap(sessionFile), [projectId]: sessionId },
              null,
              2
            )}\n`,
            'utf8'
          );
        },
        sendPrompt,
        writeReport: async (planId, markdown) => {
          mkdirSync(reportDir, { recursive: true });
          const file = join(reportDir, `${planId}.md`);
          writeFileSync(file, markdown, 'utf8');
          return file;
        },
        notifyReport,
      }),
  });

  logger.info('AlwaysOn 接线完成', {
    registered: result.registered.length,
    started: result.started,
  });
  return result;
}
