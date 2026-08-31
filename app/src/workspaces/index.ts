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
 * 统一工作空间管理模块导出
 */
export * from './types';
export * from './WorkspaceRegistry';
export * from './WorkspaceStorage';
export * from './WorkspaceScanner';
export * from './WorkspaceGit';
// G1：worktree 改动回灌主项目（apply-back）
export * from './apply/WorkspaceApply';
// G2：隔离 provider（git-worktree > snapshot-copy）+ 注册表
export * from './provider/WorkspaceProvider';
export * from './provider/WorkspaceProviderRegistry';
export * from './provider/GitWorktreeProvider';
export * from './provider/SnapshotCopyProvider';
// G5：worktree 残留回收
export * from './WorkspacePruner';
// D1-Step2 闭环：自主执行编排（隔离 → 执行 → 回灌 → 清理）
export * from './AutonomousRunner';
