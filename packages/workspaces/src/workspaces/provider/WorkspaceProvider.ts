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
 * WorkspaceProvider — 隔离工作区 Provider 抽象（G2，对标 PilotDeck WorkspaceProvider）
 *
 * 两种策略：
 *   - git-worktree（priority 1）：git 仓库 → 隔离 worktree（优先，语义最强）
 *   - snapshot-copy（priority 2）：非 git 项目 → 复制目录快照（兜底）
 *
 * 生命周期：isApplicable → prepare（创建隔离区）→ publish（回灌）→ dispose（清理）
 */

/** 隔离策略标识 */
export type WorkspaceStrategyId = 'git-worktree' | 'snapshot-copy';

/** 隔离工作区句柄（prepare 产物） */
export interface WorkspaceHandle {
  runId: string;
  projectKey: string;
  strategy: WorkspaceStrategyId;
  /** 隔离区工作目录 */
  cwd: string;
  metadata: Record<string, unknown>;
}

/** prepare 输入 */
export interface WorkspacePrepareInput {
  projectRoot: string;
  runId: string;
}

/** publish（回灌）输出 */
export interface WorkspacePublishOutput {
  /** 差异（git-worktree 为 patch；snapshot-copy 视平台 diff 可用性） */
  diff?: string;
}

/** Provider 契约（PilotDeck 对齐：低 priority 优先） */
export interface WorkspaceProvider {
  readonly id: WorkspaceStrategyId;
  readonly priority: number;
  /** 该项目是否适用本 provider */
  isApplicable(projectRoot: string): Promise<boolean>;
  /** 创建隔离工作区 */
  prepare(input: WorkspacePrepareInput): Promise<WorkspaceHandle>;
  /** 将隔离区改动回灌主项目 */
  publish(handle: WorkspaceHandle): Promise<WorkspacePublishOutput>;
  /** 清理隔离区（keep=true 保留） */
  dispose(handle: WorkspaceHandle, options: { keep: boolean }): Promise<void>;
}
