/**
 * Agent 执行隔离
 *
 * 每个 Agent 实例拥有独立的 AbortController 和工作目录，
 * 多 Agent 并行运行时互不干扰。
 */

import { mkdirSync, existsSync, rmSync } from 'fs';
import { resolvePyappHome } from '@openliri/infra/environment';
// 2026-11-09：目录可用性判据**单一实现**（infra 下沉版；会话面/工具面已共用，勿再自写一份）
import { isUsableDirectory } from '@openliri/infra/utils/toolContract/workspaceRoots';
import { getLogger } from '@openliri/infra/monitoring';
import { join } from 'path';
import type { EffectScope } from '@modules/context';

const logger = getLogger('agent:isolation');

export interface AgentIsolation {
  /** 取消信号控制器 */
  abortController: AbortController;
  /** Agent 专属工作目录 */
  workspace: string;
  /** 取消当前 Agent 的所有操作 */
  abort(reason?: string): void;
  /** 清理工作目录（可选） */
  cleanup(): void;
}

const WORKSPACES_ROOT = join(resolvePyappHome(), 'workspaces');

/**
 * 任务工作区路径（**唯一事实源**）。
 *
 * 2026-11-09：`replan` 前要对产物做快照，需要与隔离创建**同一套**路径规则；
 * 抽成导出函数避免两处各写一遍（CS01）。
 */
export function resolveTaskWorkspace(agentId: string): string {
  return join(WORKSPACES_ROOT, agentId);
}

/**
 * 会话工作区解析器（由 chat 层在装配期注册；未注册 ⇒ 全部保留任务隔离目录）。
 *
 * 2026-11-09（真机 `pdca_mw8txe5r`）：长程任务恒定跑在 `~/.pyapp/workspaces/<taskId>`
 * （空目录），会话里用户选定的工作区（含既有文件）完全不可见 ⇒ 依赖既有文件的步骤
 * 必然失败（`file_read hello.txt` → 不存在 → 重试 3 轮 + 空转 26 万 token）。
 * 现口径（方案 B）：会话/项目有可用工作区 ⇒ 就用它；**没有就用会话级目录**
 * （`resolveTaskCwd`，与聊天工具同一套安全判定）。任务级隔离目录只留给并行 Agent / 蜂群。
 */
export type TaskWorkspaceResolver = (
  sessionId: string | undefined
) => string | undefined;

let taskWorkspaceResolver: TaskWorkspaceResolver | undefined;

export function setTaskWorkspaceResolver(fn?: TaskWorkspaceResolver): void {
  taskWorkspaceResolver = fn;
}

/**
 * 把任务的 `isolation.workspace` 对齐到会话工作区（返回是否切换）。
 *
 * `sessionIdRaw` 接受 checkpoint 里的 `unknown`（未知来源一律按"无会话"处理）。
 * 目标不可用时**保留隔离目录**并告警，绝不让任务落到一个无法访问的 cwd。
 */
export function alignTaskWorkspace(
  isolation: AgentIsolation,
  taskId: string,
  sessionIdRaw: unknown
): boolean {
  const sessionId = typeof sessionIdRaw === 'string' ? sessionIdRaw : undefined;
  const target = sessionId ? taskWorkspaceResolver?.(sessionId) : undefined;
  if (!target || target === isolation.workspace) return false;
  if (!isUsableDirectory(target)) {
    logger.warn('会话工作区不可用，长程任务保留隔离目录', {
      taskId,
      sessionId,
      workspace: target,
    });
    return false;
  }
  logger.info('长程任务工作区已对齐会话工作区', {
    taskId,
    sessionId,
    previous: isolation.workspace,
    workspace: target,
  });
  isolation.workspace = target;
  return true;
}

/**
 * 把工具台账里的路径归一为**相对工作区**的路径（无法归属 ⇒ undefined）。
 *
 * 产物台账（`step.artifacts`）记录的是模型调用工具时传入的原始路径，可能是相对路径、
 * 也可能被模型写成工作区绝对路径 ⇒ 消费方（replan 复用 / 目标门取证）需要同一套换算。
 *
 * 2026-11-09：与 `resolveTaskWorkspace` 同属"工作区路径规则唯一事实源"，避免两个消费方各写一遍。
 */
export function toWorkspaceRelativePath(
  workspace: string,
  rawPath: string
): string | undefined {
  const raw = rawPath.trim();
  if (!raw) return undefined;
  const normalized = raw.replaceAll('\\', '/');
  const root = workspace.replaceAll('\\', '/').replace(/\/+$/, '');
  const isAbsolute =
    /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('/');
  if (isAbsolute) {
    // Windows 路径大小写不敏感：按小写前缀归属，保留下原大小写
    if (!normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
      return undefined;
    }
    return normalized.slice(root.length + 1);
  }
  return normalized.replace(/^(\.\/)+/, '');
}

/**
 * 为指定 Agent 创建隔离环境
 */
export function createAgentIsolation(agentId: string): AgentIsolation {
  const abortController = new AbortController();
  const workspace = resolveTaskWorkspace(agentId);

  // 创建工作目录
  if (!existsSync(workspace)) {
    mkdirSync(workspace, { recursive: true });
  }

  return {
    abortController,
    workspace,
    abort(reason?: string) {
      if (!abortController.signal.aborted) {
        abortController.abort(reason ?? 'Agent cancelled');
      }
    },
    cleanup() {
      // 只取消信号，不删除工作目录（允许事后检查）
      this.abort('Agent cleanup');
    },
  };
}

/**
 * 检查隔离是否已被取消
 */
export function isAborted(isolation: AgentIsolation): boolean {
  return isolation.abortController.signal.aborted;
}

/**
 * 如果已取消则抛出 AbortError
 */
export function throwIfAborted(isolation: AgentIsolation): void {
  if (isAborted(isolation)) {
    throw new Error('ABORTED: Agent operation cancelled');
  }
}

export interface RegisterIsolationOptions {
  /** 是否在 dispose 时删除工作目录（默认 false：允许事后检查） */
  cleanupWorkspace?: boolean;
}

/**
 * 将隔离资源（AbortController / 工作目录）登记到 EffectScope。
 * LIFO 逆序执行约定：先登记工作目录清理，再登记 abort ——
 * 保证 dispose 时 abort 最先执行，与 AgentCleanup 现状语义一致。
 */
export function registerIsolationToScope(
  isolation: AgentIsolation,
  scope: EffectScope,
  options: RegisterIsolationOptions = {}
): void {
  if (options.cleanupWorkspace) {
    scope.onDispose(() => {
      if (existsSync(isolation.workspace)) {
        rmSync(isolation.workspace, { recursive: true, force: true });
      }
    });
  }
  scope.onDispose(() => {
    isolation.abort('EffectScope disposed');
  });
}
