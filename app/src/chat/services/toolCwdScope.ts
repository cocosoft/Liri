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
import { getLogger } from '@openliri/infra/monitoring';
// P0-1（2026-11-05）：目录可用性判据下沉 infra（会话面与工具面共用同一实现）
import { isUsableDirectory } from '@openliri/infra/utils/toolContract/workspaceRoots';
import {
  isCompiledRuntime,
  isPathWithin,
  resolveProjectRoot,
  resolveScopedWorkspaceRoot,
  resolveSessionWorkspaceDir,
} from '@openliri/infra/environment';
import {
  getRequestPrincipal,
  isLocalPrincipal,
} from '@openliri/kernel/identity/requestScope';
import type { Principal } from '@openliri/kernel/identity/principal';
// 2026-11-03 P0：托管项目根（决定"缺失目录要不要自动重建"）
import { resolveProjectWorkspaceRoot } from '@modules/workspace';

const logger = getLogger('chat:services:toolCwdScope');

export interface ToolCwdDecision {
  /** 最终用于工具 `options.cwd` 的目录 */
  cwd: string;
  /** 会话工作区被拒（越出该身份根）⇒ 调用方可据此留痕 */
  rejectedSessionWorkspace: boolean;
  /**
   * G8（2026-11-03）：会话工作区不可用（不存在 / 不是目录）。
   *
   * 原实现只写 `logger.warning` ⇒ 用户看不到「项目路径失效」才是根因（导出记录里模型与用户
   * 都在猜 `cmd.exe`）。调用方据此**向会话事件流投影一条提示**（界面可见，去重见下）。
   */
  invalidSessionWorkspace?: string;
  /** G8：本次是否**首次**为（会话, 路径）告警 ⇒ 调用方只投影一次，避免刷屏 */
  shouldNotifyInvalidWorkspace?: boolean;
  /**
   * 2026-11-03 P0：会话工作区原本不存在、但位于**托管项目根**下 ⇒ 已自动重建为空目录。
   *
   * 现场：项目 `sandboxPath` 指向的目录被删/被清理后，会话仍指向它 ⇒ bash 每条都
   * `cwd_inaccessible`、相对路径读取全失败 ⇒ 模型只能反复 `glob` 猜路径 ⇒ 3 轮无进展
   * 被 `no_progress_loop` 熔断（长程任务"自动中断"的主要成因）。
   */
  recreatedSessionWorkspace?: string;
  /** P0：本次是否**首次**为（会话, 路径）提示"已自动重建" ⇒ 调用方只投影一次 */
  shouldNotifyRecreatedWorkspace?: boolean;
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
 * BUG-B（2026-10-27 真机长程任务）：请求体 `workspace_path` ⇒ 会话 `metadata.workspacePath`
 * 的**待落盘值**（返回 `undefined` 表示"无需更新"）。
 *
 * 根因：HTTP 入口只把 `workspace_path` 放进**请求** metadata，而 `getOrLoadSession` 的
 * metadata 仅在**新建会话**时生效 ⇒ 既有会话永远没有 `workspacePath` ⇒ 工具 cwd 回落
 * `resolveProjectRoot()`（代码仓根，实测把产物写进了仓库）。
 *
 * 口径：只认**绝对路径**（与 `resolveSessionWorkspacePath` 一致）；与既有值相同则不更新
 * （避免每次请求都写库）。请求值是客户端**当前显式选择** ⇒ 与既有值不同时以请求值为准。
 */
export function resolveRequestWorkspaceUpdate(input: {
  requestWorkspacePath: unknown;
  sessionWorkspacePath: unknown;
}): string | undefined {
  const incoming = input.requestWorkspacePath;
  if (typeof incoming !== 'string' || !incoming || !isAbsolute(incoming)) {
    return undefined;
  }
  if (input.sessionWorkspacePath === incoming) return undefined;
  return incoming;
}

/**
 * P1（2026-11-04，方案 §3.6）：会话**工作区根列表**的合并口径已下沉至
 * `@openliri/infra/utils/toolContract/workspaceRoots`（P0-2 同日：AlwaysOn 入口也要用，
 * 而入口不得直连 `chat` 模块）。调用方直接从 infra 导入，本模块不再转发。
 */

/**
 * P0（2026-11-03）：**会话工作区可用性**判定（缺失 / 不是目录 / 无法 stat）。
 *
 * P0-1（2026-11-05）：实现已**下沉**到 `@openliri/infra/utils/toolContract/workspaceRoots`
 * —— 会话面（`GET /v1/sessions/:id` 的 `workspaceStatus`）也要用同一判据，各写一份必然漂移。
 * 此处**原样转发**，`chat/**` 内既有约 10 处相对引用零改动。
 *
 * 为什么必须判：spawn 类工具（bash / powershell / grep…）都以 `options.cwd` 启动子进程；
 * 目录不存在时 `exec` 抛 `ENOENT … uv_spawn 'cmd.exe'` —— **把"cwd 无效"误报成"可执行文件缺失"**。
 * 真机一次会话里因此连续失败 ≥12 次，`bash` 工具被整体误判为"坏了"。
 *
 * 处置口径：**先判后用**（调用方在 spawn 前给出可操作错误），**不**静默换目录执行
 * （那会把产物写到错误位置，LRO-06 同类事故）。
 */
export { isUsableDirectory };

/** 已告警过的无效工作区（避免每次工具调用都刷同一条 warn；上限 100 条防无界增长） */
const warnedInvalidWorkspaces = new Set<string>();

/**
 * G8（2026-11-03）：告警**并按（会话, 路径）去重**。
 *
 * @returns `true` = 本次首次告警（调用方可据此向界面投影一次提示）
 */
function warnInvalidWorkspaceOnce(dir: string, sessionId?: string): boolean {
  // 去重键含 sessionId：同一失效路径在不同会话各自提示一次，进程级只保留 100 条
  const key = sessionId ? `${sessionId}::${dir}` : dir;
  if (warnedInvalidWorkspaces.has(key)) return false;
  if (warnedInvalidWorkspaces.size >= 100) warnedInvalidWorkspaces.clear();
  warnedInvalidWorkspaces.add(key);
  logger.warning(
    '会话工作区不存在或不是目录：工具将以该无效 cwd 启动 ⇒ 子进程会失败（请修正项目 sandboxPath / 会话 metadata.workspacePath）',
    { sessionWorkspacePath: dir, sessionId }
  );
  return true;
}

/**
 * G8：显式会话工作区的**唯一返回点** —— 有效原样返回；无效也原样返回（读侧不猜、不改写
 * 用户选择），但附带"界面需提示一次"的标记，由调用方投影到事件流。
 *
 * 2026-11-03 P0：**托管项目根**下的目录缺失时自动重建（`mkdir -p`），而不是让整轮任务
 * 一直失败（详见 {@link ToolCwdDecision.recreatedSessionWorkspace}）。
 */
function decideSessionWorkspace(
  dir: string,
  sessionId?: string
): ToolCwdDecision {
  if (isUsableDirectory(dir)) {
    return { cwd: dir, rejectedSessionWorkspace: false };
  }
  const recreated = recreateManagedWorkspaceOnce(dir);
  if (recreated !== null) {
    return {
      cwd: dir,
      rejectedSessionWorkspace: false,
      recreatedSessionWorkspace: recreated,
      shouldNotifyRecreatedWorkspace: markRecreatedNotifiedOnce(dir, sessionId),
    };
  }
  return {
    cwd: dir,
    rejectedSessionWorkspace: false,
    invalidSessionWorkspace: dir,
    shouldNotifyInvalidWorkspace: warnInvalidWorkspaceOnce(dir, sessionId),
  };
}

/** 已提示过"自动重建"的（会话, 路径）（上限 100 条防无界增长） */
const notifiedRecreatedWorkspaces = new Set<string>();

function markRecreatedNotifiedOnce(dir: string, sessionId?: string): boolean {
  const key = sessionId ? `${sessionId}::${dir}` : dir;
  if (notifiedRecreatedWorkspaces.has(key)) return false;
  if (notifiedRecreatedWorkspaces.size >= 100)
    notifiedRecreatedWorkspaces.clear();
  notifiedRecreatedWorkspaces.add(key);
  return true;
}

/**
 * P0（2026-11-03）：托管项目根下的缺失目录 ⇒ 重建并返回该路径；其它情况返回 `null`。
 *
 * **只重建托管根**（`resolveProjectWorkspaceRoot()` 之内，即 `~/Documents/LiriProjects` 或
 * 用户设置的「项目存放位置」）：这些目录由 Liri 自己创建与管理，重建是安全的；
 * 用户手填的任意 `workspacePath` **不重建**（可能只是写错盘符，静默建目录会掩盖错误）。
 */
function recreateManagedWorkspaceOnce(dir: string): string | null {
  if (existsSync(dir)) return null;
  try {
    if (!isPathWithin(resolveProjectWorkspaceRoot(), dir)) return null;
    mkdirSync(dir, { recursive: true });
    logger.warning('会话工作区目录不存在：已在托管项目根下自动重建为空目录', {
      sessionWorkspacePath: dir,
    });
    return dir;
  } catch (err) {
    logger.warning('会话工作区自动重建失败（按无效路径处理）', {
      sessionWorkspacePath: dir,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * 解析一次工具执行的 cwd。
 *
 * P2-4（2026-10-27）口径：**本地身份的裸会话按运行形态分流**
 * - 编译版（安装 / 便携）：`<data>/workspace/sessions/<sessionId>`（首次使用创建）——
 *   编译版的 `resolveProjectRoot()` 是 exe 所在目录（安装目录不可写 / 不该写）；
 * - 开发入口（非编译）：保持 `resolveProjectRoot()`（代码仓根，便于调试）；
 * - 已显式给出会话工作区 ⇒ 恒用会话工作区（任何形态都不覆盖用户的显式选择）。
 *
 * P0（2026-11-03）：显式工作区**存在性**判定 —— 无效时仍原样返回（读侧不猜、不改写用户选择），
 * 但会记一条**去重告警**；spawn 类工具据此在执行前给出可操作错误（见 `BashTool`）。
 *
 * @param sessionWorkspacePath 会话元数据里的工作区（可能来自请求体，未经验证）
 * @param principal 当前请求身份（缺省取 ALS）
 * @param options `sessionId` 供裸会话锚定会话级目录；`compiled` 仅供单测注入
 */
export function resolveToolCwd(
  sessionWorkspacePath: string | null | undefined,
  principal: Principal = getRequestPrincipal(),
  options: { sessionId?: string; compiled?: boolean } = {}
): ToolCwdDecision {
  if (isLocalPrincipal(principal)) {
    if (sessionWorkspacePath) {
      return decideSessionWorkspace(sessionWorkspacePath, options.sessionId);
    }
    const compiled = options.compiled ?? isCompiledRuntime();
    if (compiled && options.sessionId) {
      // bash / grep / glob 都以 cwd 启动 ⇒ 目录必须存在，否则工具直接失败
      // （只在真正回落到会话级目录时创建，避免每次调用都碰文件系统）
      const dir = resolveSessionWorkspaceDir(options.sessionId);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      return { cwd: dir, rejectedSessionWorkspace: false };
    }
    return { cwd: resolveProjectRoot(), rejectedSessionWorkspace: false };
  }

  const root = resolveScopedWorkspaceRoot(principal);
  if (sessionWorkspacePath && isPathWithin(root, sessionWorkspacePath)) {
    return decideSessionWorkspace(sessionWorkspacePath, options.sessionId);
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
