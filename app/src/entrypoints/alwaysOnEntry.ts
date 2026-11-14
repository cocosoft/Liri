/**
 * AlwaysOn 入口接线（U-02，2026-10-20 最小可用自主执行 v1.1）。
 *
 * 职责：把**宿主能力**（ChatManager / ProjectStore / 报告目录 / 主动通知）装配成桥接器依赖，
 * 再交给 `bootstrapAlwaysOn()`。放在 `entrypoints/` 是为了守住 R00-001：
 * `tasks` 层不直接依赖 `chat` / `workspace` / `proactive` 的实现细节。
 *
 * v1.1（处理方案 §9 偏差）：
 * - 会话**跨重启复用**（P34 起落在 `workitems.session_id`；原 `alwayson/sessions.json`
 *   旁路台账已移除，同一项目多轮运行共享一个 Ticket、每轮一条 Assignment）；
 * - 超时**真正中止**（`streamMessage` + `AbortSignal`，不再只记失败）；
 * - 工具面收窄（discovery `taskType='messaging'` 只读面 / execution `taskType='coding'`）；
 * - 报告**主动通知**（复用主动队列 + 同一门禁与去重口径）；
 * - 项目来源覆盖**所有工作空间**（`listAll()` + `default`，按项目 id 去重）。
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { DEFAULT_TIMEZONE, MS_PER_DAY } from '@openliri/infra/constants';
import { configManager } from '@openliri/infra/config';
// 2026-11-03 P0：运行预算（默认放宽 + 可调）与按项目的「自主执行」开关
// （放 infra/config：handler 属 service 层，不能依赖 app/tasks）
import {
  AUTONOMY_LIMITS_CONFIG_KEY,
  PROJECT_AUTONOMY_CONFIG_KEY,
  isProjectAutonomyEnabled,
  readAutonomyLimits,
  readProjectAutonomyMap,
} from '@openliri/infra/config';
import {
  resolveDataDir,
  resolveScopedDataDir,
} from '@openliri/infra/environment';
import { feature, globalEventBus } from '@openliri/kernel';
// 2026-11-03 P1：把自主执行运行态提供给 service 层 HTTP handler（DI 端口，避免反向依赖）
import { dependencyRegistry } from '@openliri/kernel/DependencyRegistry.js';
import { getLogger } from '@openliri/infra/monitoring';
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
  loadAutonomyPolicy,
  parseGoalEvaluation,
  readPdcaWorkItem,
  unverifiedGoal,
  writePdcaWorkItem,
  type AlwaysOnBridgeDeps,
  type AlwaysOnProject,
} from '@modules/tasks';
import { checkDailyBudget } from '@modules/query/dailyBudgetGate';
// P34（2026-11-02）：派工生命周期落库
import { upsertTicketAssignment } from '../tasks/ticketAssignmentStore';
// P1（2026-11-14）：`proactive` 迁入 `packages/proactive`（层仍为 app）
import { getActiveProactiveQueue } from '@modules/proactive/ProactiveRuntime';
import { resolveProactiveTarget } from '@modules/proactive/ProactiveTargetResolver';
import { resolveProactiveGatePrefs } from '@modules/proactive/ProactiveCronProducer';
import { evaluateProactiveNotification } from '@modules/proactive/ProactiveNotificationGate';
import type { ProactiveMessagePayload } from '@modules/proactive/types';
import { listAll } from '@modules/workspaces/WorkspaceRegistry';
// P0-2（2026-11-04，issue #35）：工作区根列表的**唯一合并口径**（与权限层/执行前同一实现；
// 已于同日下沉 infra —— 入口不得直连 `chat` 模块，见 eslint `no-direct-module-import`）
import { mergeWorkspaceRoots } from '@openliri/infra/utils/toolContract/workspaceRoots';
// P0-2 残留（2026-11-04 真机复核）：预置根取**所属仓库根**，而不是任务目标的叶子目录
import { findEnclosingRepoRoot } from '@openliri/infra/utils/toolContract/repoRoot';

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

/**
 * P34（2026-11-02）：项目级工作项 id（同一项目的多轮运行共享一个 Ticket）。
 *
 * 会话映射与派工都挂在它下面 —— 不再维护 `alwayson/sessions.json` 旁路台账，
 * 驾驶舱也能把该项目的历史聚合成一条工作项。
 */
const ALWAYSON_WORK_ITEM_PREFIX = 'alwayson:';
function workItemIdFor(projectId: string): string {
  return `${ALWAYSON_WORK_ITEM_PREFIX}${projectId}`;
}

/** 设置页「功能开关」在配置里的键（`PUT /v1/config/features` ⇒ `settings.features`） */
const FEATURES_CONFIG_KEY = 'features';

/** 当前已启动的 AlwaysOn 句柄（用于运行期按用户设置停止/重启；`null` ⇒ 未启动） */
let active: AlwaysOnStartResult | null = null;

/** 当前管理器（按项目暂停/恢复时需要 `getRuntime(projectId)`；`null` ⇒ 未启动） */
let activeManager: AlwaysOnManager | null = null;

/** 配置变更订阅是否已挂（`startAlwaysOn` 可能被多次调用 ⇒ 只挂一次） */
let settingsSubscribed = false;

/** 项目删除订阅是否已挂（同上，幂等） */
let projectRemovalSubscribed = false;

/**
 * 2026-11-03（缺口 #2）：**运行期项目注册器** —— 由 `startAlwaysOn` 在启动成功时挂上，
 * 新建项目事件据此立即注册（此前只在启动期收集，新建须重启才进入自主执行）。
 * `null` ⇒ 未启动 / 已停止。
 */
let projectRegistrar: ((project: AlwaysOnProject) => boolean) | null = null;

/** 项目创建订阅是否已挂（同上，幂等） */
let projectCreationSubscribed = false;

/** 2026-11-03 P1：已注册项目的元数据（`getAlwaysOnStatus` 用它补全名字/路径） */
const projectMeta = new Map<string, { name: string; path: string }>();

/** DI 端口键（`/v1/autonomy/status` 由 handler 侧注入；未提供 ⇒ 前端显示"未启动"） */
const AUTONOMY_STATUS_PORT_KEY = 'autonomy:status';
let statusPortProvided = false;

/** 2026-11-03 P1：单个项目的自主执行运行态（前端「运行状况」直接渲染） */
export interface AlwaysOnProjectStatus {
  projectId: string;
  name: string;
  path: string;
  /** 用户开关（`autonomy.projects`，缺省开） */
  enabled: boolean;
  /** 是否已在运行时注册（项目路径存在且已注册） */
  registered: boolean;
  /** 调度是否在跑（tick 定时器） */
  running: boolean;
  todayCount: number;
  dailyBudget: number;
  lastRunAt: number | null;
  /** `lastRunAt + cooldown`（粗略的"下次可跑"时刻） */
  nextEligibleAt: number | null;
  /** 最近一次门控结论（"为什么没在跑"） */
  lastGate: {
    passed: boolean;
    reason?: string;
    detail?: string;
    at: number;
  } | null;
}

/**
 * 2026-11-03 P1：自主执行运行态快照（`/v1/autonomy/status` 的唯一实现）。
 *
 * 只读：不触发 tick、不改门控状态；未启动时返回 `running:false` + 空项目表。
 */
export function getAlwaysOnStatus(): {
  enabled: boolean;
  running: boolean;
  projects: AlwaysOnProjectStatus[];
} {
  const limits = readAutonomyLimits();
  const snapshots = activeManager?.runtimeSnapshots() ?? [];
  const byId = new Map(snapshots.map((s) => [s.projectId, s]));

  const projects = [...projectMeta.entries()].map(([projectId, meta]) => {
    const snap = byId.get(projectId);
    const gates = snap?.gates;
    const lastRunAt = gates && gates.lastRunAt > 0 ? gates.lastRunAt : null;
    return {
      projectId,
      name: meta.name,
      path: meta.path,
      enabled: isProjectAutonomyEnabled(projectId),
      registered: !!snap,
      running: !!snap?.running,
      todayCount: gates?.todayCount ?? 0,
      dailyBudget: gates?.dailyBudget ?? limits.dailyBudget,
      lastRunAt,
      nextEligibleAt:
        lastRunAt !== null && gates
          ? lastRunAt + gates.cooldownMinutes * 60_000
          : null,
      lastGate: gates?.lastGate ?? null,
    };
  });

  return {
    enabled: resolveAlwaysOnEnabled(),
    running: !!active?.started,
    projects,
  };
}

/** 注册 DI 端口（幂等；即使 AlwaysOn 关闭也注册，前端可据 `enabled:false` 显示） */
function ensureStatusPort(): void {
  if (statusPortProvided) return;
  statusPortProvided = true;
  dependencyRegistry.provide(AUTONOMY_STATUS_PORT_KEY, () =>
    getAlwaysOnStatus()
  );
}

/**
 * 读取用户设置里的 `alwaysOn`。
 *
 * 缺失 / 非布尔 ⇒ `undefined`（不干预，回落静态默认 `FEATURE_FLAGS.ALWAYSON`）。
 * 2026-11-03 前该值只被前端写、无人读 ⇒ 设置页开关是死开关。
 */
export function readAlwaysOnPreference(): boolean | undefined {
  const features = configManager.getConfigValue(FEATURES_CONFIG_KEY) as
    | { alwaysOn?: unknown }
    | undefined;
  return typeof features?.alwaysOn === 'boolean'
    ? features.alwaysOn
    : undefined;
}

/**
 * 当前**生效**的 AlwaysOn 开关值（设置页开关 → 后端运行时）。
 *
 * 优先级：`FEATURE_<name>` env（运维/灰度，最高）> 用户设置 > `feature()`（变体层 / 静态默认）。
 * 为什么不像其它开关那样只调 `feature()`：`feature()` 不看用户设置（只认 env / 变体 / 默认），
 * 而设置页的开关写的是配置（`features.alwaysOn`）⇒ 必须在此显式合并，否则又是死开关。
 */
export function resolveAlwaysOnEnabled(): boolean {
  if (process.env['FEATURE_ALWAYSON'] !== undefined) return feature('ALWAYSON');
  return readAlwaysOnPreference() ?? feature('ALWAYSON');
}

/**
 * 按用户设置**运行期**启停 AlwaysOn（幂等）。
 *
 * - 关：立即 `teardown()`（停掉各项目 5 分钟 tick 定时器）；
 * - 开：未启动才 `startAlwaysOn()`（env `FEATURE_ALWAYSON=false` 仍优先 ⇒ 只记警告不启动）。
 */
async function applyAlwaysOnEnabled(enabled: boolean): Promise<void> {
  if (!enabled) {
    if (active?.started) {
      active.teardown();
      logger.info('AlwaysOn 已按用户设置停止（定时器已释放）');
    }
    active = null;
    activeManager = null;
    // 2026-11-03（缺口 #2）：停止后不再接受运行期新建（下次启动由 collectProjects 收）
    projectRegistrar = null;
    return;
  }
  if (active?.started) return;
  if (!resolveAlwaysOnEnabled()) {
    logger.warn(
      '用户设置要求启动 AlwaysOn，但 FEATURE_ALWAYSON=false（env 优先），未启动'
    );
    return;
  }
  active = await startAlwaysOn();
}

/**
 * 订阅「项目已删除」⇒ 注销该项目的自主执行运行时（2026-11-03）。
 *
 * 取证：两个删除入口（`DELETE /v1/projects/:id` · `/v1/workspaces/:id/projects/:projectId`）
 * 此前只删实体、不通知 AlwaysOn ⇒ 运行时继续每 5 分钟 tick 一个已删项目
 * （照常上报工作项 / 生成报告；路径缺失时还会被 cwd 自愈重建）。
 * 事件由两处 handler 发布（service 层不反向依赖 entry）；幂等挂载。
 */
function subscribeProjectRemoval(): void {
  if (projectRemovalSubscribed) return;
  projectRemovalSubscribed = true;
  globalEventBus.subscribe(
    'project:deleted',
    (payload: { projectId?: unknown } | undefined) => {
      const projectId = payload?.projectId;
      if (typeof projectId !== 'string' || !projectId) return;
      // 运行态快照以 `projectMeta` 为准 ⇒ 一并移除，前端「运行状况」不再显示已删项目
      projectMeta.delete(projectId);
      activeManager?.unregisterProject(projectId);
      logger.info('项目已删除，已注销自主执行运行时', { projectId });
    }
  );
}

/**
 * 订阅「项目已创建」⇒ 运行期注册该项目（2026-11-03 缺口 #2）。
 *
 * 取证：`collectProjects()` 只在启动时收集一次 ⇒ 新建项目**要重启**才进入自主执行
 * （与删除侧缺口对称）。事件由 `ProjectStore.create()` 统一发布（覆盖 HTTP / 自动建项目
 * 等全部创建入口）；`delaySandbox` 的项目此时目录可能不存在 ⇒ `registerOne` 按路径存在性跳过。
 * 幂等挂载；未启动（`projectRegistrar === null`）⇒ 无操作，下次启动自然收集。
 */
function subscribeProjectCreation(): void {
  if (projectCreationSubscribed) return;
  projectCreationSubscribed = true;
  globalEventBus.subscribe(
    'project:created',
    (
      payload:
        | {
            projectId?: unknown;
            name?: unknown;
            path?: unknown;
            ownerKey?: unknown;
          }
        | undefined
    ) => {
      const projectId = payload?.projectId;
      const path = payload?.path;
      if (typeof projectId !== 'string' || !projectId) return;
      if (typeof path !== 'string' || !path) return;
      const name =
        typeof payload?.name === 'string' && payload.name
          ? payload.name
          : projectId;
      const ownerKey =
        typeof payload?.ownerKey === 'string' ? payload.ownerKey : undefined;
      const registered =
        projectRegistrar?.({
          id: projectId,
          name,
          path,
          ...(ownerKey ? { ownerKey } : {}),
          // 与启动期同口径：按项目开关决定是否真正调度
          enabled: isProjectAutonomyEnabled(projectId),
        }) ?? false;
      // 只有真正注册成功才进运行态快照（路径不存在/已注册 ⇒ 保持原样）
      if (registered) projectMeta.set(projectId, { name, path });
      logger.info('project:created 已处理', { projectId, registered });
    }
  );
}

/** 订阅配置变更（设置页开关写入后立刻生效）；幂等 */
function subscribeSettingsChanges(): void {
  if (settingsSubscribed) return;
  settingsSubscribed = true;
  globalEventBus.subscribe(
    'config:changed',
    (payload: { key?: string; value?: unknown } | undefined) => {
      if (payload?.key === FEATURES_CONFIG_KEY) {
        const preference = (payload.value as { alwaysOn?: unknown } | undefined)
          ?.alwaysOn;
        if (typeof preference !== 'boolean') return;
        void applyAlwaysOnEnabled(preference).catch((error: unknown) => {
          logger.warn('应用 AlwaysOn 开关失败', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
        return;
      }
      if (payload?.key === PROJECT_AUTONOMY_CONFIG_KEY) {
        applyProjectAutonomy();
        return;
      }
      // 2026-11-03 P0：预算改动 ⇒ 重建调度（manager 的 config 构造期固定；未启动则下次启动即生效）
      if (payload?.key === AUTONOMY_LIMITS_CONFIG_KEY) {
        void restartAlwaysOnForNewLimits().catch((error: unknown) => {
          logger.warn('按新预算重启 AlwaysOn 失败', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }
  );
}

/** 预算变更后重建调度（计数随新预算归零，属预期） */
async function restartAlwaysOnForNewLimits(): Promise<void> {
  if (!active?.started) return;
  await applyAlwaysOnEnabled(false);
  await applyAlwaysOnEnabled(true);
  logger.info('AlwaysOn 已按新预算重启', readAutonomyLimits());
}

/**
 * 按 `autonomy.projects` 把**每个已注册项目**的调度对齐到配置（幂等）。
 *
 * - 暂停：`runtime.stop()`（停 5 分钟 tick 与文件信号监听；在飞这一轮不强行中止）；
 * - 恢复：`gates.setEnabled(true)` + `runtime.start()`；
 * - 未注册（全局已关 / 项目无 sandboxPath）⇒ 跳过，下次 `startAlwaysOn()` 按配置生效。
 */
function applyProjectAutonomy(): void {
  if (!activeManager) return;
  const map = readProjectAutonomyMap();
  for (const projectId of Object.keys(map)) {
    const runtime = activeManager.getRuntime(projectId);
    if (!runtime) continue;
    const enabled = map[projectId]?.enabled === true;
    // 用 `project_disabled` 而不是全局 `disabled`（日志可区分"整体关"与"只关这个项目"）
    runtime.gates.setProjectPaused(!enabled);
    if (enabled) runtime.start();
    else runtime.stop();
    logger.info('按项目开关应用自主执行', { projectId, enabled });
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
        // 多租户 P3：项目归属（创建时由请求身份写入；本地项目无此字段 ⇒ 不查配额）
        ownerKey:
          typeof project.ownerKey === 'string' ? project.ownerKey : undefined,
        // 2026-11-03：按项目的「自主执行」开关（缺省开；显式 false ⇒ 注册但不调度）
        enabled: isProjectAutonomyEnabled(project.id),
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
 *
 * 2026-11-03：用户设置（设置页「自主执行模式」）优先于静态默认 —— 见 {@link resolveAlwaysOnEnabled}，
 * 运行期改开关经 {@link applyAlwaysOnEnabled} 即时启停。
 */
export async function startAlwaysOn(): Promise<AlwaysOnStartResult> {
  subscribeSettingsChanges();
  // 项目删除订阅与开关无关：关闭态下也要清掉 `projectMeta`（避免「运行状况」显示已删项目）
  subscribeProjectRemoval();
  // 2026-11-03（缺口 #2）：新建项目订阅（真正生效取决于 running 时的 `projectRegistrar`）
  subscribeProjectCreation();
  ensureStatusPort();
  // 每次启动重建注册器绑定（旧绑定指向已 teardown 的 manager ⇒ 必须先清）
  projectRegistrar = null;
  if (!resolveAlwaysOnEnabled()) {
    logger.info('AlwaysOn 未启用（用户设置关闭 或 FEATURE_ALWAYSON=false）');
    return { registered: [], started: false, teardown: () => {} };
  }

  const chatManager = getCoreAPI().getChatManager();
  const dataDir = resolveDataDir();
  const projectStore = createProjectStore(dataDir, new WorkItemStore(dataDir));
  const projects = await collectProjects(projectStore);

  // 2026-11-03 P1：登记项目元数据（`/v1/autonomy/status` 用它补全名字/路径）
  for (const project of projects) {
    projectMeta.set(project.id, { name: project.name, path: project.path });
  }

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

  /**
   * 多租户 P3：AlwaysOn 的运行产物（报告 / 补丁 / 快照 / 会话索引）**按调用时的身份**落盘。
   *
   * 上述三处都在 `AlwaysOnRuntime.tryRun()` 的身份作用域内被调用（workspace / report /
   * session），所以租户项目自动落到 `<scoped>/alwayson/…`；本地项目解析结果仍是原
   * `dataDir`（零变更）。**不要**在启动期把路径算成常量 —— 那会把所有租户钉在同一目录。
   */
  const alwaysOnRoot = (): string => join(resolveScopedDataDir(), 'alwayson');
  const reportDir = (): string => join(alwaysOnRoot(), 'reports');
  /** snapshot-copy 回退的快照根目录（非 git / 脏仓项目的兜底隔离区） */
  const snapshotDir = (): string => join(alwaysOnRoot(), 'snapshots');
  // 2026-11-03 P0：预算来自 `autonomy.limits`（默认已放宽；用户在设置页可调）
  const autonomyLimits = readAutonomyLimits();
  const manager = new AlwaysOnManager({
    dailyBudget: autonomyLimits.dailyBudget,
    cooldownMinutes: autonomyLimits.cooldownMinutes,
  });
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
    const snapshot = new SnapshotCopyProvider({ baseDir: snapshotDir() });
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
          mkdirSync(reportDir(), { recursive: true });
          patchPath = join(
            reportDir(),
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
   *
   * 2026-11-03：顺带补齐项目归属（`projectId` / `moduleType`）——
   * 存量自主会话只有 `workspaceId`，按 `projectId` 过滤的列表会漏掉它们；
   * 每轮 discovery 都会走到这里 ⇒ 存量会话自然回填，无需一次性迁移脚本。
   *
   * P0-2（2026-11-04，issue #35）：`targetRoot` = 任务**真实目标目录**（项目根），
   * 与 cwd 一起写进 `metadata.workspaceRoots`（恒在首）。原因：执行阶段的 `cwd` 是
   * 隔离副本，模型却按真实项目路径读写 ⇒ 不预置则每次都被判越界、弹一张很快过期的
   * 审批卡（等价于"照旧拒绝"）。只影响**路径边界**（多根允许），不改 cwd、不改隔离策略、
   * 不绕过 deny 规则；用户已批准追加的其它根原样保留（合并走同一实现）。
   */
  const setSessionWorkspace = async (
    sessionId: string,
    cwd: string,
    projectId?: string,
    targetRoot?: string
  ): Promise<void> => {
    // P3：存量会话（本次升级前创建）没有 `workspaceStrict` ⇒ 一并补上，避免严格边界失效
    const basePatch: Record<string, unknown> = {
      workspacePath: cwd,
      workspaceStrict: true,
      ...(projectId ? { projectId, moduleType: 'project' } : {}),
    };
    /** 目标根恒在首 + 既有追加根（去重口径与权限层/执行前同一实现） */
    const rootsOf = (metadata: unknown): Record<string, unknown> => {
      if (!targetRoot) return {};
      const roots = mergeWorkspaceRoots(
        targetRoot,
        (metadata as Record<string, unknown> | undefined)?.workspaceRoots
      );
      return roots.length > 0 ? { workspaceRoots: roots } : {};
    };
    const cached = await chatManager.loadSession(sessionId);
    if (cached) {
      cached.metadata = {
        ...(cached.metadata ?? {}),
        ...basePatch,
        ...rootsOf(cached.metadata),
      };
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
    stored.metadata = {
      ...(stored.metadata ?? {}),
      ...basePatch,
      ...rootsOf(stored.metadata),
    };
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

  // P35（2026-11-02）：fs 来源 + 执行消费 —— 仅在策略显式开启 `sources.fs` 时注册。
  // 默认 `false` ⇒ 不建 watcher、不产生/执行 Ticket，现有行为零变更。
  // 执行消费另有闸门：策略 `enabled=true && acceptMode='auto'`（见 ticketRunConsumer）。
  const autonomyPolicy = loadAutonomyPolicy();
  if (autonomyPolicy.config.sources.fs === true) {
    /**
     * fs 执行会话复用（按**目录**）：同一工作目录的多次文件变更共用一条会话，
     * 避免"每个事件都新建会话"把历史切碎。映射只在进程内（重启后首轮新建）。
     */
    const fsSessionByWorkspace = new Map<string, string>();
    const watchPaths = projects
      .map((project) => project.path)
      .filter((path): path is string => !!path);
    if (watchPaths.length > 0) {
      try {
        const { startFsSignalPipeline } =
          await import('../tasks/sources/fsWiring');
        await startFsSignalPipeline({
          watchPaths,
          executeTicket: async (ticket) => {
            const payload = (ticket.payload ?? {}) as Record<string, unknown>;
            const path = typeof payload.path === 'string' ? payload.path : '';
            const kind =
              typeof payload.kind === 'string' ? payload.kind : 'change';
            // 会话 cwd 指向变更所在目录（文件 ⇒ dirname，目录 ⇒ 自身；严格边界）
            let workspacePath: string | undefined;
            if (path) {
              try {
                workspacePath =
                  existsSync(path) && statSync(path).isDirectory()
                    ? path
                    : dirname(path);
              } catch {
                workspacePath = dirname(path);
              }
            }
            const sessionKey = workspacePath ?? '__fs__';
            let sessionId = fsSessionByWorkspace.get(sessionKey);
            if (sessionId) {
              // 会话可能已被用户删除 ⇒ 内存 Map 与持久层都不存在时才新建
              const alive =
                (await chatManager.loadSession(sessionId)) ??
                (await chatManager.getSessionGateway().getSession(sessionId));
              if (!alive) sessionId = undefined;
            }
            if (!sessionId) {
              const session = await chatManager.createSession({
                title: `触发 · ${path ? (path.split(/[\\/]/).pop() ?? 'fs') : 'fs'}`,
                description: '文件变更触发的只读检查会话',
                tags: ['trigger', 'fs'],
                ...(workspacePath
                  ? {
                      metadata: {
                        workspacePath,
                        workspaceStrict: true,
                      },
                    }
                  : {}),
              });
              sessionId = session.id;
              fsSessionByWorkspace.set(sessionKey, sessionId);
            }
            let tokens = 0;
            const output = await sendPrompt(
              sessionId,
              `文件变更：${path}（${kind}）。只做只读检查并给出结论与建议；不要修改任何文件。`,
              {
                onUsage: (usage) => {
                  tokens += usage.totalTokens ?? 0;
                },
              },
              { taskType: 'alwayson_discovery' }
            );
            return { success: true, output, tokens, sessionId };
          },
        });
        logger.info('FS Source 注册完成', {
          watchPaths: watchPaths.length,
        });
      } catch (error) {
        logger.warn('FS Source 注册失败（不影响 AlwaysOn）', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * D1（2026-11-14）：外部事件来源（webhook / GitHub issue / 邮件轮询共用入口）。
   *
   * 仅在策略显式开启 `sources.external` 时注册；未启用 ⇒ 不注册来源、不注入受理端口
   * ⇒ `POST /v1/events/external` 回 503（默认零行为变更）。
   * 执行面沿用 `alwayson_discovery`（只读）+ prompt 明令禁止改文件。
   */
  if (autonomyPolicy.config.sources.external === true) {
    try {
      const { startExternalEventPipeline } =
        await import('../tasks/sources/externalEventWiring');
      const externalSessionRef: { id?: string } = {};
      await startExternalEventPipeline({
        executeTicket: async (ticket) => {
          const payload = (ticket.payload ?? {}) as Record<string, unknown>;
          const triggerId =
            typeof ticket.triggerId === 'string' ? ticket.triggerId : '';
          const summary = JSON.stringify(payload).slice(0, 2000);

          let sessionId = externalSessionRef.id;
          if (sessionId) {
            const alive =
              (await chatManager.loadSession(sessionId)) ??
              (await chatManager.getSessionGateway().getSession(sessionId));
            if (!alive) sessionId = undefined;
          }
          if (!sessionId) {
            const session = await chatManager.createSession({
              title: '触发 · 外部事件',
              description: '外部系统推送触发的事件分析会话',
              tags: ['trigger', 'external'],
            });
            sessionId = session.id;
            externalSessionRef.id = sessionId;
          }

          let tokens = 0;
          const output = await sendPrompt(
            sessionId,
            `外部事件（${triggerId}）：${summary}。只做分析与建议；不要修改任何文件。`,
            {
              onUsage: (usage) => {
                tokens += usage.totalTokens ?? 0;
              },
            },
            { taskType: 'alwayson_discovery' }
          );
          return { success: true, output, tokens, sessionId };
        },
      });
      logger.info('External Source 注册完成');
    } catch (error) {
      logger.warn('External Source 注册失败（不影响 AlwaysOn）', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

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
    projectId,
    planId,
    condition,
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
      // 2026-10-31 根因修复：去重身份 = **项目 + 条件**（原为每轮唯一的 planId ⇒ 去重永不命中）。
      // 同一项目同一条件在门禁的去重 TTL（24h）内只投递一条。
      dedupeKey: `alwayson:${projectId}:${condition}`,
      title,
      body,
      // U-01 方案 A：显式配置了 `proactive.target.*` 才外发到通道，否则写通知中心。
      target: resolveProactiveTarget(configManager),
      createdAt: now,
      expiresAt: now + MS_PER_DAY,
      source: { type: 'alwayson', ref: `${projectId}:${condition}:${planId}` },
      // P37：结构化注意力事实（跑到这里必是"需人介入"，成功时另带可用成果）
      attention: {
        humanWaiting: false,
        needsDecision: true,
        usableOutput: success,
      },
      // P37：以**计划**为工作项口径 —— 同一计划最多打扰 2 次（台账 = 主动队列）
      ticketId: planId,
    };
    // 含 pending 的"已承诺"回看：否则同拍并发入队会读到同一份旧快照、整批穿透限流
    const recent = await queue.listRecentCommitted(now - MS_PER_DAY);
    const decision = evaluateProactiveNotification(payload, {
      now,
      timezone: DEFAULT_TIMEZONE,
      prefs: resolveProactiveGatePrefs(),
      recent,
    });
    if (decision.action === 'drop') return false;
    // P37：过程性进展只写日志，不进收件箱（三档里的 silent）
    if (decision.tier === 'silent') {
      logger.info('alwayson:report:silent', { projectId, planId, condition });
      return false;
    }
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
    // 2026-11-03 P0：每轮预算同样来自 `autonomy.limits`
    limits: {
      maxToolCalls: autonomyLimits.maxToolCalls,
      timeoutMinutes: autonomyLimits.timeoutMinutes,
    },
    createBridge: (project, limits) => {
      // P0-2 残留（2026-11-04 真机复核）：预置根取**所属仓库根**（向上找 `.git`）。
      // 只预置任务目标的叶子目录时，模型改兄弟目录即被判越界（15Z 实测 41 次：
      // 根里只有 `app\src\ai\router`，而模型要读 `app\src\tasks\…`）。
      // 找不到 `.git`（含目录不存在）⇒ 退回 `project.path`，行为与改造前逐字一致。
      const targetRoot = findEnclosingRepoRoot(project.path) ?? project.path;
      return createAlwaysOnBridge({
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        // P34：项目级 Ticket（多轮运行共享）
        workItemId: workItemIdFor(project.id),
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
              // P0-2（2026-11-04，issue #35）：把**任务真实目标根**预置为工作区根
              // —— 执行阶段 cwd 会切到隔离副本，若不预置，模型按真实项目路径读写一律
              // 被判越界（旧 TTL 5 分钟的审批卡 ⇒ 等价于持续拒绝）。
              // 真机复核后改为"所属仓库根"（见上方 targetRoot）：叶子目录授权不够用。
              workspaceRoots: mergeWorkspaceRoots(targetRoot, []),
              workspaceId: id,
              // 2026-11-03：补齐项目归属 —— 此前只有 workspaceId，缺 projectId/moduleType
              // ⇒ 按 `projectId` / `moduleType=project` 过滤的列表与接口会漏掉自主会话
              projectId: project.id,
              moduleType: 'project',
              // P3：工具路径入参必须落在会话工作区内（绝对路径 / `../` 直接拒绝）
              workspaceStrict: true,
              alwayson: true,
            },
          });
          return session.id;
        },
        prepareWorkspace,
        finishWorkspace,
        setSessionWorkspace: (sessionId, cwd) =>
          setSessionWorkspace(sessionId, cwd, project.id, targetRoot),
        // P34：会话映射落在 `workitems.session_id`（Ticket 持有会话），
        // 不再维护 `sessions.json`；重启后从工作项读回同一会话。
        loadSession: async (projectId) => {
          const row = await readPdcaWorkItem(workItemIdFor(projectId));
          return typeof row?.sessionId === 'string' ? row.sessionId : undefined;
        },
        saveSession: async (projectId, sessionId) => {
          await writePdcaWorkItem({
            id: workItemIdFor(projectId),
            title: `AlwaysOn · ${project.name}`,
            // 项目级 Ticket 常驻 active（每次运行的结果由最新 Assignment 的 reportState 表达）
            status: 'active',
            workspaceDir: project.path,
            sessionId,
            updatedAt: new Date().toISOString(),
          });
        },
        sendPrompt,
        // 目标达成自评（默认开）：关掉即回到 `unverified（未做模型自评）` 的 v2 口径。
        ...(feature('ALWAYSON_GOAL_EVAL') ? { evaluateGoal } : {}),
        writeReport: async (planId, markdown) => {
          mkdirSync(reportDir(), { recursive: true });
          const file = join(reportDir(), `${planId}.md`);
          writeFileSync(file, markdown, 'utf8');
          return file;
        },
        notifyReport,
        // P34（2026-11-02）：派工生命周期落库（`ticket_assignments`）。
        // 与 `reports/<planId>.md` 互补：报告是人读的产物，派工记录是机器读的事实
        // （stage 派生 / 面板 / 恢复统计都读它）。
        recordAssignment: async (record) => {
          await upsertTicketAssignment({
            assignmentId: record.assignmentId,
            workItemId: record.workItemId,
            executor: record.executor,
            state: record.state,
            ...(record.reportState ? { reportState: record.reportState } : {}),
            ...(record.reportText ? { reportText: record.reportText } : {}),
            ...(record.sessionId ? { sessionId: record.sessionId } : {}),
            startedAt: record.startedAt,
            ...(record.endedAt !== undefined
              ? { endedAt: record.endedAt }
              : {}),
            updatedAt: Date.now(),
          });
        },
      });
    },
  });

  // 记下句柄：设置页关闭开关时据此 teardown（未启动 ⇒ 不留陈句柄）
  active = result.started ? result : null;
  activeManager = result.started ? manager : null;
  // 2026-11-03（缺口 #2）：启动成功才挂运行期注册器（新建项目立即纳入自主执行）
  projectRegistrar = result.started
    ? (project) => !!result.registerProject(project)
    : null;

  logger.info('AlwaysOn 接线完成', {
    registered: result.registered.length,
    started: result.started,
  });
  return result;
}
