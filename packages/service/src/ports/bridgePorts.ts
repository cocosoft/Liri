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
 * Bridge 域运行时 —— **服务层端口**（子批 D；2026-10-01 台账 D-207）
 *
 * **为什么需要**：`bridge/BridgeMain.ts`（service）静态导入 app 层
 * `@modules/workspaces/WorkspaceGit.js` · `.../WorkspacePruner.js`
 * （`createWorkspaceGit` · `pruneOrphanWorktrees`）⇒ `bridge -> workspaces` 倒挂（1 条边）。
 *
 * 按 §3.4 #5 处置：新增本端口（**不**复用 `workspaceOpsPorts.ts` —— 经核，该端口只覆盖
 * "工作空间上下文/工作项存储"，与本处"worktree 隔离"能力**不同域**，故按 CS01 另立最小端口）。
 *
 * ⚠️ 端口**禁止引用 app 类型**（`R00-001` 连类型导入也计）⇒ 返回值按调用方**实际读取面**投影：
 * BridgeMain 只读 `worktreeInfo.worktreePath`（`BridgeMain.ts:370`），故只投影该字段。
 */

/** worktree 管理器（**最小投影** —— `BridgeMain` 实际调用的 3 个方法） */
export interface WorktreeManagerPort {
  /** 为会话创建工作树；调用方只读 `worktreePath`（`BridgeMain.ts:369-370`） */
  createWorktree(sessionId: string): Promise<{ worktreePath: string }>;
  /** 移除会话工作树 */
  removeWorktree(sessionId: string): Promise<void>;
  /** 停机时清空全部工作树 */
  clearAllWorktrees(): Promise<void>;
}

/** Bridge 运行时端口（2 方法 = `BridgeMain.ts` 的**实际调用面**） */
export interface BridgePort {
  /** 构造 worktree 管理器（`baseDir` = `BridgeMain` 的 `config.dir`） */
  createWorktreeManager(options: { baseDir: string }): WorktreeManagerPort;
  /** 清理孤儿 worktree（崩溃/异常退出残留）；返回被清理的路径列表 */
  pruneOrphanWorktrees(gitRoot: string): Promise<string[]>;
}
