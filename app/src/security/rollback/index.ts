// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, modify, copy, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit us to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 对话级文件回滚模块导出
 *
 * 实施阶段覆盖：
 *   R0a: 核心数据结构 + 文件操作拦截层 + 快照存储
 *   R0b: 快照创建 + 应用启动清理中断轮次 + 元数据校验
 *   R1:  撤消执行 + WAL 崩溃恢复 + undoGuard
 *   R2:  级联撤消（findDependentRounds + cleanupOrphanFiles）
 *   R3:  用户修改检测（detectUserModifications）
 *   R4:  AI 上下文注入（AIContextInjector）
 *   R5:  状态管理 + 清理策略 + 配额管理
 *   R6:  重做执行（RedoManager）
 */

// ==================== 核心类型 ====================
export type { RollbackPermissionCheckFn } from './RollbackIntegration';

export type {
  FileChange,
  FileChangeType,
  FileStat,
  ScanStatus,
  SnapshotStatus,
  RoundSnapshot,
  UndoResult,
  TimelineEntry,
  StorageUsage,
  SnapshotCleanupPolicy,
  UndoGuardState,
  RedoConflict,
  WalEntry,
  SessionIndexEntry,
  InjectStrategy,
} from './types';

// ==================== 文件操作追踪 ====================
export { FileOperationTracker } from './FileOperationTracker';
export type { FileOperation } from './FileOperationTracker';

// ==================== 快照存储 ====================
export {
  createRoundSnapshot,
  loadSnapshot,
  deleteRoundSnapshot,
  listSessionSnapshots,
  updateSessionIndex,
  getTotalSnapshotSize,
  getSnapshotsRoot,
  getManifestPath,
  getBackupsDir,
} from './SnapshotStorage';

// ==================== 清理管理 ====================
export {
  cleanupInterruptedRounds,
  cleanupRoundTempFiles,
  enforceSnapshotQuota,
  onApplicationStart,
} from './CleanupManager';

// ==================== 撤消执行（R1 + R2 + R3） ====================
export {
  executeUndo,
  previewUndo,
  detectRedoConflicts,
  recoverFromCrash,
  detectUserModifications,
  findDependentRounds,
  cleanupOrphanFiles,
} from './UndoManager';

// ==================== 重做执行（R6） ====================
export { executeRedo, canRedo } from './RedoManager';
export type { RedoResult } from './RedoManager';

// ==================== AI 上下文注入（R4） ====================
export {
  generateUndoContext,
  generateDetailedUndoContext,
  shouldInjectContext,
} from './AIContextInjector';

// ==================== 集成层 ====================
export { RollbackIntegration } from './RollbackIntegration';

// ==================== 哈希工具 ====================
export { xxHash, encodeFilePath, xxHashBuffer } from './xxHash';
