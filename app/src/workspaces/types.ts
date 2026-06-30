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
 * 工作空间元数据
 * 存储在每个工作空间目录下的 .workspace.json 中
 */
export interface WorkspaceMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  description: string;
}

/**
 * 工作空间条目
 * 用于列表展示，合并元数据与运行时统计
 */
export interface WorkspaceEntry {
  name: string;
  path: string;
  meta: WorkspaceMeta;
  fileCount: number;
  isActive: boolean;
}

/**
 * 工作空间注册表
 * 存储于 ~/.pyapp/workspaces.json
 */
export interface WorkspaceRegistryData {
  workspaces: Record<string, string>;
  defaultRoot: string;
  activeWorkspace: string | null;
}

/**
 * Git Worktree 信息
 */
export interface WorktreeInfo {
  worktreePath: string;
  worktreeBranch: string;
  gitRoot: string;
  hookBased: boolean;
}

/**
 * 工作空间扫描结果（单个文件）
 */
export interface WorkspaceFile {
  name: string;
  content: string;
  filePath: string;
  mtimeMs: number;
  truncated: boolean;
}

/**
 * 工作空间文件集合
 */
export interface WorkspaceFiles {
  agentsMd: WorkspaceFile | null;
  toolsMd: WorkspaceFile | null;
  agentsDirFiles: WorkspaceFile[];
}
