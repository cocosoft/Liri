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

import { statSync } from 'node:fs';

/**
 * 会话**工作区根列表**的合并口径（纯函数，唯一实现）。
 *
 * 沿革：2026-11-04（方案 §3.6）落在 `chat/services/toolCwdScope`；同日 P0-2 发现
 * `entrypoints/alwaysOnEntry` 也要用同一口径（预置任务真实目标根），而 eslint
 * `module-registry/no-direct-module-import` 禁止入口直连 `chat` 模块 ⇒ 按
 * `pathBoundary` 的同一先例**下沉**到 `utils/toolContract`（infra），避免再写第二份。
 *
 * 口径：`primary`（主工作区，恒在首） + `extra`（`metadata.workspaceRoots`：用户批准
 * 越界申请时追加，见 `runtime/inboxApproval.ts`，写入时已做父子折叠）。去重按
 * "去尾斜杠 + 小写"归一（Windows 大小写不敏感）。
 *
 * 消费方：权限层 `auto-local` 边界（`findWorkspaceEscapeInRoots`）、执行前严格边界
 * （`ToolExecutionService`）、AlwaysOn 会话根预置（`entrypoints/alwaysOnEntry`）。
 * **不得**再各写一份拼接/去重逻辑。
 */
export function mergeWorkspaceRoots(
  primary: string | undefined,
  extra: unknown
): string[] {
  const normalize = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase();
  const roots: string[] = [];
  const seen = new Set<string>();
  const push = (candidate: unknown): void => {
    if (typeof candidate !== 'string' || !candidate.trim()) return;
    const key = normalize(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    roots.push(candidate);
  };
  push(primary);
  if (Array.isArray(extra)) for (const root of extra) push(root);
  return roots;
}

/**
 * 目录是否可用（存在且是目录）。
 *
 * P0-1（2026-11-05）：由 `chat/services/toolCwdScope` **下沉**到此 —— 会话面（`GET /v1/sessions/:id`
 * 的工作区状态）与工具面（spawn 前 cwd 判定）必须同一判据，各写一份必然漂移（CS01）。
 *
 * 为什么必须判：spawn 类工具以 `options.cwd` 启动子进程，目录不存在时 `exec` 抛
 * `ENOENT … uv_spawn 'cmd.exe'`（把"cwd 无效"误报成"可执行文件缺失"）。
 */
export function isUsableDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** 会话工作区状态（P0-1，2026-11-05） */
export type WorkspaceStatusState =
  /** 会话没有绑定任何工作区（未配置，不是错误） */
  | 'unbound'
  /** 全部根可用 */
  | 'ok'
  /** 部分根已失效（多根场景：用户批准追加过的根被删） */
  | 'partial'
  /** 全部根已失效（典型：worktree 被清理后会话仍钉在旧根） */
  | 'invalid';

export interface WorkspaceStatus {
  state: WorkspaceStatusState;
  /** 会话当前的工作区根（首根 = 主工作区） */
  roots: string[];
  /** 已失效的根（`state` 为 `partial` / `invalid` 时非空） */
  missingRoots: string[];
}

/**
 * 计算会话工作区状态（纯逻辑 + 可注入判据，便于测试）。
 *
 * 真机背景（2026-11-05）：worktree 被删后，会话的 `metadata.workspacePath` 仍指向死目录，
 * 表现为首次工具调用才报「路径越界 / ENOENT」。会话面提前给出状态，可在**发消息前**
 * 告诉用户"工作区已失效"，而不是等工具连续失败。
 */
export function computeWorkspaceStatus(
  roots: readonly string[],
  isUsable: (dir: string) => boolean = isUsableDirectory
): WorkspaceStatus {
  if (roots.length === 0) {
    return { state: 'unbound', roots: [], missingRoots: [] };
  }
  const missingRoots = roots.filter((root) => !isUsable(root));
  const state: WorkspaceStatusState =
    missingRoots.length === 0
      ? 'ok'
      : missingRoots.length === roots.length
        ? 'invalid'
        : 'partial';
  return { state, roots: [...roots], missingRoots };
}
