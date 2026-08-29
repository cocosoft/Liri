/**
 * Agent 执行隔离
 *
 * 每个 Agent 实例拥有独立的 AbortController 和工作目录，
 * 多 Agent 并行运行时互不干扰。
 */

import { mkdirSync, existsSync, rmSync } from 'fs';
import { resolvePyappHome } from '@modules/core';
import { join } from 'path';
import type { EffectScope } from '@modules/context';

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
 * 为指定 Agent 创建隔离环境
 */
export function createAgentIsolation(agentId: string): AgentIsolation {
  const abortController = new AbortController();
  const workspace = join(WORKSPACES_ROOT, agentId);

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
