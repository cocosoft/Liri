/**
 * AlwaysOn 启动接线（U-02，2026-10-20 最小可用自主执行 v1）。
 *
 * 只做三件事：**注册项目 → 注入 4 阶段实现 → 打开门控并启动**。
 * 开关关闭时**零副作用**（不注册、不 start），与接线前逐字一致。
 */
import { existsSync } from 'node:fs';
import { AlwaysOnManager } from './AlwaysOnManager';
import type { AlwaysOnRuntime } from './AlwaysOnRuntime';
import type { AlwaysOnBridge } from './AlwaysOnBridge';
import { DEFAULT_ALWAYSON_CONFIG } from './types';
import { cg3Log } from '../cg3Env';

/** 一个可自主执行的项目（`path` 必须是真实存在的目录） */
export interface AlwaysOnProject {
  id: string;
  name: string;
  path: string;
  /**
   * 归属键（多租户 P3）：`<tenantId>:<userId>`。
   * 缺失 ⇒ 本地项目（不查归属配额、不加身份作用域），与改造前一致。
   */
  ownerKey?: string;
  /**
   * 该项目的自主执行开关（2026-11-03）：显式 `false` ⇒ 注册但**不启动**调度
   * （运行期可经 `AlwaysOnManager.getRuntime(id).start()` 恢复）。
   * 缺省 / `true` ⇒ 正常运行。
   */
  enabled?: boolean;
}

export interface AlwaysOnBootstrapDeps {
  /** `feature('ALWAYSON')` */
  enabled: boolean;
  projects: readonly AlwaysOnProject[];
  manager: AlwaysOnManager;
  /** 每项目一个桥接器（同一实例的 discovery/execution 共享 `lastPlan`） */
  createBridge: (
    project: AlwaysOnProject,
    limits: { maxToolCalls: number; timeoutMinutes: number }
  ) => AlwaysOnBridge;
  /** 路径存在性判定（测试可注入） */
  pathExists?: (path: string) => boolean;
}

export interface AlwaysOnBootstrapResult {
  /** 实际注册（并启动）的项目 id */
  registered: string[];
  started: boolean;
  teardown: () => void;
}

/**
 * @returns 注册结果；`enabled=false` 或无可执行项目 ⇒ `started:false`
 */
export function bootstrapAlwaysOn(
  deps: AlwaysOnBootstrapDeps
): AlwaysOnBootstrapResult {
  const pathExists = deps.pathExists ?? existsSync;
  if (!deps.enabled) {
    return { registered: [], started: false, teardown: () => {} };
  }

  const limits = {
    maxToolCalls: DEFAULT_ALWAYSON_CONFIG.execution.maxToolCalls,
    timeoutMinutes: DEFAULT_ALWAYSON_CONFIG.execution.timeoutMinutes,
  };
  const registered: string[] = [];
  /** 显式暂停的项目：仍注册（便于运行期恢复），但 `manager.start()` 后立即停掉调度 */
  const paused: AlwaysOnRuntime[] = [];

  for (const project of deps.projects) {
    if (!project.path || !pathExists(project.path)) {
      cg3Log('tasks:alwayson:bootstrap', 'warn', 'project:skipped', {
        projectId: project.id,
        reason: project.path ? 'path-missing' : 'path-empty',
      });
      continue;
    }

    // 多租户 P3：归属随项目带进运行时（缺失 ⇒ 本地项目，行为与改造前一致）
    const runtime = deps.manager.registerProject(
      project.id,
      project.path,
      project.ownerKey
    );
    const projectEnabled = project.enabled !== false;
    runtime.gates.setEnabled(projectEnabled);
    if (!projectEnabled) paused.push(runtime);

    const bridge = deps.createBridge(project, limits);
    runtime.setDiscoveryFn(bridge.discovery);
    runtime.setWorkspaceFn(bridge.workspace);
    runtime.setExecutionFn(bridge.execution);
    runtime.setReportFn(bridge.report);

    registered.push(project.id);
  }

  if (registered.length === 0) {
    cg3Log('tasks:alwayson:bootstrap', 'info', 'no-project');
    return { registered, started: false, teardown: () => {} };
  }

  deps.manager.start();
  // 2026-11-03：`start()` 会启动全部已注册运行时 ⇒ 显式暂停的项目随后停掉调度
  // （运行期在设置里恢复时再 `runtime.start()`，见 `alwaysOnEntry` 的 config:changed 订阅）
  for (const runtime of paused) runtime.stop();
  cg3Log('tasks:alwayson:bootstrap', 'info', 'started', {
    projects: registered.length,
    paused: paused.length,
  });

  return {
    registered,
    started: true,
    teardown: () => deps.manager.stop(),
  };
}
