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
 * 工具调用的**工作区边界**判定（纯函数）。
 *
 * 沿革：原落 `tasks/lro/workspaceGuard.ts`（U-03b / U-09，2026-10-17，LRO 专用）。
 * 2026-10-20（U-02 v2 / P3）**下沉**到 infra：AlwaysOn 的隔离 worktree 也需要同一判定，
 * 而 `chat/services/ToolExecutionService`（app）反向 import `tasks`（app）会与
 * 「`tasks → chat`」成环 ⇒ 统一落 `utils/toolContract`。LRO 原路径保留转发文件。
 *
 * 背景：工具上下文 `options.cwd` 已指向隔离工作区，但模型可显式传绝对路径
 * 或 `../` 跳出工作区（读系统目录 / 写项目根）。本模块在工具执行前做一次纯函数校验，
 * 仅对**路径语义入参**生效（单一事实源 = `PATH_ARG_KEYS`）。
 *
 * 启用条件由调用方决定（**默认不启用**）：当前仅
 *   ① LRO 隔离步骤（`tasks/lro/stepExecution.ts`）；
 *   ② 会话显式声明 `metadata.workspaceStrict === true`（AlwaysOn 隔离轮）——
 *      其余普通会话零行为变更。
 */
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path';
import { realpathSync } from 'node:fs';
import { PATH_ARG_KEYS } from './pathArgs';

export interface WorkspaceEscape {
  key: string;
  value: string;
  resolved: string;
  /**
   * 越界判定路径（U-24）：
   *  - `lexical` —— 纯字符串解析即已越界；
   *  - `symlink` —— 字面仍在 workspace 内，但**真实路径**（符号链接展开后）越界。
   */
  via: 'lexical' | 'symlink';
}

export interface WorkspaceGuardDeps {
  /** 真实路径解析（测试注入；缺省 `realpath` 最近存在祖先 + 其余段拼回） */
  realPath?: (p: string) => string;
}

/**
 * 解析真实路径：对**尚不存在**的目标（如写新文件）逐级上溯到最近存在的祖先，
 * 再把剩余段拼回 ⇒ 既能展开符号链接，又能覆盖"目标尚未创建"的场景。
 *
 * 任一步失败 ⇒ 原样返回（不阻断主流程；调用方仍以词法路径做第一道判定）。
 */
function defaultRealPath(target: string): string {
  let current = target;
  const trailing: string[] = [];
  for (;;) {
    try {
      const real = realpathSync.native(current);
      return trailing.length > 0 ? join(real, ...trailing.reverse()) : real;
    } catch {
      const parent = dirname(current);
      if (parent === current) return target;
      trailing.push(basename(current));
      current = parent;
    }
  }
}

/** 是否位于 root 之外（与既有词法判定同口径） */
function isOutside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== '' && (rel.startsWith('..') || isAbsolute(rel));
}

/**
 * 查找第一个越界路径参数；全部在 workspace 内（或该工具无路径参数）⇒ `null`。
 *
 * 规则：
 *  1. **词法**：相对路径按 workspace 解析；绝对路径必须仍位于 workspace 内；
 *  2. **真实路径（U-24）**：展开符号链接后再判一次 —— 防"workspace 内链接指向外部"
 *     的 TOCTOU/旁路（纯词法检查看不见链接目标）。
 *
 * 注：本函数只做**执行前**判定，无法消除"判定与访问之间"的并发替换窗口（真 TOCTOU）；
 * 该窗口由 Landlock/沙箱在执行侧兜底，见 `dev_docs/20261009/复查任务计划.md` N2。
 */
export function findWorkspaceEscape(
  workspace: string,
  args: Record<string, unknown>,
  deps: WorkspaceGuardDeps = {}
): WorkspaceEscape | null {
  const root = resolve(workspace);
  const realPath = deps.realPath ?? defaultRealPath;
  const realRoot = realPath(root);
  for (const key of PATH_ARG_KEYS) {
    const value = args[key];
    if (typeof value !== 'string' || !value.trim()) continue;

    const resolved = isAbsolute(value) ? resolve(value) : resolve(root, value);
    if (isOutside(root, resolved)) {
      return { key, value, resolved, via: 'lexical' };
    }
    if (isOutside(realRoot, realPath(resolved))) {
      return { key, value, resolved, via: 'symlink' };
    }
  }
  return null;
}
