// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * AutonomousRunner — 自主执行编排（D1-Step2 闭环）
 *
 * 将已落地的组件串成完整闭环：
 *   计划/指令 → Provider 隔离（git-worktree > snapshot-copy）→ 隔离区内执行
 *     → apply-back（diff 回灌主项目）→ 清理隔离区
 *
 * 职责边界：
 * - 本编排器负责"隔离环境 + 回灌 + 清理"，不执行 LLM/工具循环（由调用方传入 execute）。
 * - 执行回调内应使用 DreamDenyRules 校验命令/工具（自主运行 deny 远程/危险操作）。
 * - snapshot-copy 模式（非 git 项目）publish 返回占位 diff → applied=false（需人工合并）。
 */
import { resolveDataSubDir } from '@modules/core/paths';
import { WorkspaceProviderRegistry } from './provider/WorkspaceProviderRegistry';
import { GitWorktreeProvider } from './provider/GitWorktreeProvider';
import { SnapshotCopyProvider } from './provider/SnapshotCopyProvider';
import { createWorkspaceSnapshot } from './apply/WorkspaceSnapshot';
import type {
  WorkspaceHandle,
  WorkspaceProvider,
  WorkspaceStrategyId,
} from './provider/WorkspaceProvider';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('workspaces:autonomous');

/** 隔离区内执行上下文（execute 回调可见） */
export interface AutonomousExecContext {
  /** 隔离区工作目录（文件工具/bash 相对路径基于此） */
  cwd: string;
  projectRoot: string;
}

/** 自主任务输入 */
export interface AutonomousTaskInput {
  projectRoot: string;
  runId: string;
  /** 隔离区内执行逻辑（调用方：agent 循环 / dream 处理 / 自定义任务） */
  execute: (ctx: AutonomousExecContext) => Promise<void>;
}

/** 自主任务结果 */
export interface AutonomousTaskResult {
  runId: string;
  strategy: WorkspaceStrategyId;
  /** git-worktree 回灌成功为 true；snapshot-copy（无 diff）为 false（需人工合并） */
  applied: boolean;
  diff?: string;
  error?: string;
  /** P1-4（2026-08-31）：execute 前自动快照 hash（apply-back 失败时保留隔离区，可 restoreWorkspaceSnapshot 回滚） */
  snapshotHash?: string;
}

/**
 * 执行一次隔离自主任务
 */
export async function runAutonomousTask(
  input: AutonomousTaskInput
): Promise<AutonomousTaskResult> {
  const registry = new WorkspaceProviderRegistry();
  // 优先级：git-worktree(1) > snapshot-copy(2)，纯自动选择
  registry.add(
    new SnapshotCopyProvider({ baseDir: resolveDataSubDir('workspaces') })
  );
  registry.add(new GitWorktreeProvider({ projectRoot: input.projectRoot }));

  let handle: WorkspaceHandle | undefined;
  let provider: WorkspaceProvider | undefined;
  let snapshotHash: string | undefined;
  // P1-4：apply-back 失败时保留隔离区（含快照），防止回灌失败后改动被清理丢失
  let keepIsolation = false;
  try {
    const prepared = await registry.prepare({
      projectRoot: input.projectRoot,
      runId: input.runId,
    });
    handle = prepared.handle;
    provider = prepared.provider;

    logger.info('AutonomousRunner: 隔离区就绪，开始执行', {
      runId: input.runId,
      strategy: handle.strategy,
      cwd: handle.cwd,
    });

    // P1-4（2026-08-31）：execute 前自动影子 git 快照（对标 Hermes checkpoint），
    // 失败仅 warn 不阻断（快照是增强，非主流程依赖）
    if (handle.strategy === 'git-worktree') {
      snapshotHash = await createWorkspaceSnapshot(
        handle.cwd,
        `before-execute-${input.runId}`
      )
        .then((s) => s.hash)
        .catch((e) => {
          logger.warn('AutonomousRunner: 执行前快照失败（不影响执行）', {
            runId: input.runId,
            error: String(e),
          });
          return undefined;
        });
    }

    await input.execute({ cwd: handle.cwd, projectRoot: input.projectRoot });

    // apply-back：将隔离区改动回灌主项目
    let out;
    try {
      out = await provider.publish(handle);
    } catch (error) {
      // P1-4：回灌失败 → 保留隔离区与快照（调用方可 restoreWorkspaceSnapshot 回滚 / 手动合并）
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn('AutonomousRunner: 回灌失败，保留隔离区与快照', {
        runId: input.runId,
        error: msg,
        snapshotHash,
      });
      keepIsolation = true;
      return {
        runId: input.runId,
        strategy: handle.strategy,
        applied: false,
        error: `apply-back failed: ${msg}`,
        snapshotHash,
      };
    }
    const applied = !!(out.diff && !out.diff.startsWith('snapshot at '));
    logger.info('AutonomousRunner: 执行完成，回灌结果', {
      runId: input.runId,
      applied,
      diffBytes: out.diff?.length ?? 0,
    });
    return {
      runId: input.runId,
      strategy: handle.strategy,
      applied,
      diff: out.diff,
      snapshotHash,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn('AutonomousRunner: 自主任务失败', {
      runId: input.runId,
      error: msg,
    });
    return {
      runId: input.runId,
      strategy: handle?.strategy ?? 'snapshot-copy',
      applied: false,
      error: msg,
      snapshotHash,
    };
  } finally {
    if (handle && provider) {
      try {
        await provider.dispose(handle, { keep: keepIsolation });
      } catch (error) {
        logger.warn('AutonomousRunner: 隔离区清理失败', {
          runId: input.runId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
