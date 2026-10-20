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
import { configManager } from '@modules/config';
import { feature, resolveDataDir } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { WorkItemStore, createProjectStore } from '@modules/workspace';
import {
  GitWorktreeProvider,
  SnapshotCopyProvider,
  generateWorkspaceDiff,
  pruneNamespaceWorktrees,
  type WorkspaceHandle,
  type WorkspaceProvider,
} from '@modules/workspaces';

import {
  AlwaysOnManager,
  DEFAULT_ALWAYSON_CONFIG,
  bootstrapAlwaysOn,
  buildGoalEvaluationPrompt,
  createAlwaysOnBridge,
  parseGoalEvaluation,
  unverifiedGoal,
  type AlwaysOnBridgeDeps,
  type AlwaysOnProject,
} from '@modules/tasks';
import { checkDailyBudget } from '../query/dailyBudgetGate';
import { getActiveProactiveQueue } from '../proactive/ProactiveRuntime';
import { resolveProactiveTarget } from '../proactive/ProactiveTargetResolver';
import { resolveProactiveGatePrefs } from '../proactive/ProactiveCronProducer';
import { evaluateProactiveNotification } from '../proactive/ProactiveNotificationGate';
import type { ProactiveMessagePayload } from '../proactive/types';
import { listAll } from '../workspaces/WorkspaceRegistry';

const logger = getLogger('entrypoints:alwayson');

/**
 * AlwaysOn 隔离区的 worktree / 分支命名前缀（P4，2026-10-20）。
 * 与 Bridge 的 `bridge` 命名空间分离 ⇒ `git worktree list` / `git branch` 可辨识，
 * 启动回收也只动本前缀。
 */
const ALWAYSON_WORKTREE_PREFIX = 'alwayson';

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

  // P4（2026-10-20）：回收上次进程崩溃/异常退出残留的 `alwayson-*` worktree。
  // 这类是**已注册**的 worktree，`pruneOrphanWorktrees()` 不会清 ⇒ 按命名空间单独回收。
  // 不阻塞启动：失败只记日志（清理失败不影响本轮可用性）。
  for (const project of projects) {
    void pruneNamespaceWorktrees(project.path, ALWAYSON_WORKTREE_PREFIX).catch(
      (error) => {
        logger.warn('AlwaysOn 残留隔离区清理失败', {
          projectId: project.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    );
  }

  const reportDir = join(dataDir, 'alwayson', 'reports');
  /** snapshot-copy 回退的快照根目录（非 git / 脏仓项目的兜底隔离区） */
  const snapshotDir = join(dataDir, 'alwayson', 'snapshots');
  const sessionFile = join(dataDir, 'alwayson', 'sessions.json');
  const manager = new AlwaysOnManager();
  /** 本轮隔离区句柄（runId → provider + handle）；worktree 的 Map 在 provider 内部，必须复用同一实例 */
  const activeRuns = new Map<
    string,
    { provider: WorkspaceProvider; handle: WorkspaceHandle }
  >();

  /**
   * 准备本轮隔离区（v2 P2；2026-10-20 增 snapshot-copy 回退）。
   *
   * 顺序：`GitWorktreeProvider`（`refuseDirty`，语义最强）→ 不可用（非 git / 有未提交改动）
   * 且 `ALWAYSON_SNAPSHOT_FALLBACK` 开 ⇒ `SnapshotCopyProvider`（目录快照，排除 .git/node_modules 等）。
   * 两者都不可用 ⇒ `skippedReason`，**不退回直连项目目录**（方案 §10.7 裁定 B：
   * 宁可跳过，不可悄悄改用户工作区）。
   */
  const prepareWorkspace: AlwaysOnBridgeDeps['prepareWorkspace'] = async ({
    projectPath,
    runId,
  }) => {
    const provider = new GitWorktreeProvider({
      projectRoot: projectPath,
      refuseDirty: true,
      // P4：独立命名空间（目录 `alwayson-<id>` / 分支 `alwayson/<id>`）
      namePrefix: ALWAYSON_WORKTREE_PREFIX,
    });
    if (await provider.isApplicable(projectPath)) {
      try {
        // `runId` 形如 `alwayson-<projectId>-<ts>`；前缀已由 provider 补 ⇒ 去掉重复段
        const worktreeId = runId.replace(/^alwayson-/, '');
        const handle = await provider.prepare({
          projectRoot: projectPath,
          runId: worktreeId,
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
    }

    // 回退：非 git / 脏仓 ⇒ 目录快照（不碰主目录；产物默认保留待人工合并）
    if (!feature('ALWAYSON_SNAPSHOT_FALLBACK')) {
      return { skippedReason: 'not_git_repo_or_dirty' };
    }
    const snapshot = new SnapshotCopyProvider({ baseDir: snapshotDir });
    if (!(await snapshot.isApplicable(projectPath))) {
      return { skippedReason: 'not_git_repo_or_dirty' };
    }
    try {
      const handle = await snapshot.prepare({
        projectRoot: projectPath,
        runId: runId.replace(/^alwayson-/, ''),
      });
      activeRuns.set(runId, { provider: snapshot, handle });
      logger.info('AlwaysOn 回退 snapshot-copy 隔离', {
        runId,
        cwd: handle.cwd,
      });
      return {
        workspace: {
          cwd: handle.cwd,
          strategy: handle.strategy,
          ref: { runId },
        },
      };
    } catch (error) {
      return {
        skippedReason: `snapshot_failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  };

  /**
   * 收尾（v2 P2/P5）：把隔离区改动**导出**（不自动 apply），再清理隔离区。
   *
   * - `git-worktree`：`git diff HEAD` → `<reportDir>/<runId>.patch`（可 `git apply`）；
   *   落盘失败 / 超长截断 ⇒ `keep: true` 保留 worktree。
   * - `snapshot-copy`：`diff -ruN`（平台无 `diff` ⇒ 空）→ 有真实差异时写 `<runId>.diff`；
   *   该策略**无 git 语义、不能自动回灌** ⇒ 一律 `keep: true`，由用户到快照目录取改动。
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

    const isSnapshot = active.handle.strategy === 'snapshot-copy';
    let diffText = '';
    let truncated = false;
    if (isSnapshot) {
      const published = await active.provider.publish(active.handle);
      const raw = published.diff ?? '';
      // provider 在平台无 `diff` 时返回 `snapshot at <cwd>` 占位 ⇒ 不是真实差异
      diffText = raw.startsWith('snapshot at ') ? '' : raw;
    } else {
      const diff = await generateWorkspaceDiff(active.handle.cwd);
      diffText = diff.diff;
      truncated = diff.truncated;
    }

    let patchPath: string | undefined;
    let keep = isSnapshot;
    let error: string | undefined;

    if (diffText.trim().length > 0) {
      if (truncated) {
        // 截断的补丁无法 `git apply` ⇒ 不导出，保留隔离区交人工处理
        keep = true;
        error = 'diff-truncated: 补丁超长已截断，未导出（隔离区已保留）';
      } else {
        try {
          mkdirSync(reportDir, { recursive: true });
          patchPath = join(
            reportDir,
            `${runId}${isSnapshot ? '.diff' : '.patch'}`
          );
          writeFileSync(patchPath, diffText, 'utf8');
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
      diffBytes: diffText.length,
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
    // P3：存量会话（本次升级前创建）没有 `workspaceStrict` ⇒ 一并补上，避免严格边界失效
    const patch: Record<string, unknown> = {
      workspacePath: cwd,
      workspaceStrict: true,
    };
    const cached = await chatManager.loadSession(sessionId);
    if (cached) {
      cached.metadata = { ...(cached.metadata ?? {}), ...patch };
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

  /**
   * 目标达成自评（2026-10-20 产品裁定启用）：多一次**只读**模型调用。
   *
   * - 预算：先过 `checkDailyBudget`（硬闸门单一收口）；locked ⇒ 不评估（`unverified`），
   *   保证自评本身不会成为穿透预算的入口；
   * - 工具面：`alwayson_discovery`（只读面）+ prompt 明令禁止调用工具 —— 本轮改动只在
   *   隔离区且**未 apply**，去仓库里读只会得出"没改"的错误结论；
   * - 超时：独立中止，不拖住报告；
   * - 任何异常 ⇒ `unverified`（`source` 说明原因），**不**当成"未达成"。
   */
  const evaluateGoal: NonNullable<AlwaysOnBridgeDeps['evaluateGoal']> = async (
    input
  ) => {
    const { sessionId, ...promptInput } = input;
    const budget = checkDailyBudget({
      sessionId,
      estimatedTokens:
        DEFAULT_ALWAYSON_CONFIG.execution.goalEvalEstimatedTokens,
    });
    if (!budget.allowed) {
      logger.info('alwayson:goal-eval:skipped', {
        sessionId,
        reason: 'budget-locked',
      });
      return unverifiedGoal('skipped:budget', '日预算已锁定，未做自评');
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      DEFAULT_ALWAYSON_CONFIG.execution.goalEvalTimeoutMs
    );
    try {
      const text = await sendPrompt(
        sessionId,
        buildGoalEvaluationPrompt(promptInput),
        {},
        { taskType: 'alwayson_discovery', abortSignal: controller.signal }
      );
      const evaluation = parseGoalEvaluation(text);
      logger.info('alwayson:goal-eval', {
        sessionId,
        verdict: evaluation.verdict,
        source: evaluation.source ?? '',
      });
      return evaluation;
    } catch (error) {
      logger.warn('alwayson:goal-eval:failed', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return unverifiedGoal(
        'error:evaluate-failed',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      clearTimeout(timer);
    }
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
      // U-01 方案 A：显式配置了 `proactive.target.*` 才外发到通道，否则写通知中心。
      target: resolveProactiveTarget(configManager),
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
              // P3：工具路径入参必须落在会话工作区内（绝对路径 / `../` 直接拒绝）
              workspaceStrict: true,
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
        // 目标达成自评（默认开）：关掉即回到 `unverified（未做模型自评）` 的 v2 口径。
        ...(feature('ALWAYSON_GOAL_EVAL') ? { evaluateGoal } : {}),
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
