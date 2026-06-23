// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, modify, copy, merge, publish, distribute, sublicense, and/or sell
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
 * 对话级文件回滚 — 核心类型定义
 *
 * 本文件定义了文件变更追踪、快照存储、撤消执行所需的所有数据结构。
 * 对应方案文档 §3.1–§3.2 的数据模型设计。
 */

/** 文件变更类型 */
export type FileChangeType =
  | 'created'
  | 'deleted'
  | 'modified'
  | 'renamed'
  | 'moved';

/** 扫描状态 */
export type ScanStatus = 'complete' | 'partial';

/** 快照状态 */
export type SnapshotStatus = 'active' | 'cleaned' | 'rolled_back';

/** 注入策略 */
export type InjectStrategy =
  | 'next_request'
  | 'interrupt_and_refresh'
  | 'ui_only';

/**
 * 文件变更记录
 * 对应方案文档 §3.1 的 FileChange 接口
 */
export interface FileChange {
  /** 文件绝对路径 */
  path: string;

  /** 变更类型 */
  type: FileChangeType;

  /** 修改前的备份路径 */
  backupPath?: string;

  /** 修改后的备份路径（用于重做） */
  afterBackupPath?: string;

  /** 修改前文件大小 */
  originalSize?: number;

  /** 修改前文件修改时间 */
  originalMtime?: string;

  /** 文件内容的 xxHash 值（用于完整性校验） */
  hash?: string;

  /** renamed/moved 操作的旧路径 */
  oldPath?: string;

  /** renamed/moved 操作的新路径 */
  newPath?: string;
}

/**
 * 文件系统状态快照
 * 对应方案文档 §3.1 的 RoundSnapshot 接口
 */
export interface RoundSnapshot {
  /** 轮次编号 */
  roundId: number;

  /** 所属会话 ID */
  sessionId: string;

  /** 触发本轮的用户消息摘要 */
  userMessageSummary: string;

  /** 创建时间戳 */
  createdAt: string;

  /** 变更文件列表 */
  changedFiles: FileChange[];

  /** 快照总大小（字节） */
  totalSize: number;

  /** 数据模型版本号，用于向前兼容 */
  schemaVersion: number;

  /** 是否存储修改后版本（用于重做） */
  storeAfterVersion: boolean;

  /** 扫描状态（完整 / 部分） */
  scanStatus: ScanStatus;

  /** 快照当前状态 */
  status: SnapshotStatus;

  /** 校验和（用于完整性验证） */
  checksum?: string;
}

/**
 * 撤消执行结果
 * 对应方案文档 §4.1 的 UndoResult 接口
 */
export interface UndoResult {
  /** 是否全部成功 */
  success: boolean;

  /** 已恢复的 deleted 文件数 */
  restoredFiles: number;

  /** 已回退的 modified 文件数 */
  revertedFiles: number;

  /** 已删除的 created 文件数 */
  removedFiles: number;

  /** 跳过不覆盖的用户修改文件数 */
  skippedUserModified: number;

  /** 级联撤消的额外轮次列表 */
  cascadedRounds: number[];

  /** 失败列表 */
  failures: string[];
}

/**
 * 文件统计信息（用于快照扫描）
 */
export interface FileStat {
  /** 文件大小（字节） */
  size: number;

  /** 最后修改时间 */
  mtime: string;
}

/**
 * 文件操作时间线条目
 * 用于检测被后续轮次修改的文件
 */
export interface TimelineEntry {
  /** 文件路径 */
  path: string;

  /** 操作所在轮次 */
  roundId: number;

  /** 操作类型 */
  type: FileChangeType;
}

/**
 * 存储用量统计
 */
export interface StorageUsage {
  /** 回滚快照总大小 */
  roundSnapshots: number;

  /** 安全加固快照总大小 */
  securitySnapshots: number;

  /** 合计大小 */
  totalSize: number;

  /** 配额上限 */
  quota: number;
}

/**
 * 快照清理策略
 * 对应方案文档 §9.2
 */
export interface SnapshotCleanupPolicy {
  /** 超配额时的行为 */
  onThresholdExceeded: 'clean_oldest' | 'notify_user';

  /** 会话活跃时保留所有快照 */
  keepAllActive: boolean;

  /** 会话结束后保留时长 */
  sessionKeepDuration: string;

  /** 过期后的处理方式 */
  afterExpiry: 'compress' | 'delete';

  /** 自动清理周期（毫秒） */
  cleanupIntervalMs: number;
}

/**
 * 撤消保护快照（undoGuard）
 * 用于撤消前创建快照，防止撤消失败导致不可恢复
 */
export interface UndoGuardState {
  /** 被保护的轮次 */
  roundId: number;

  /** 撤消前状态的备份文件列表 */
  preState: FileChange[];

  /** 是否已被回滚 */
  hasBeenRolledBack: boolean;
}

/**
 * 重做冲突检测结果
 */
export interface RedoConflict {
  /** 冲突的文件路径 */
  path: string;

  /** 冲突原因 */
  reason:
    | 'file_modified_in_later_round'
    | 'file_locked_by_editor'
    | 'cross_session_conflict';

  /** 当前文件 hash */
  currentHash?: string;

  /** 快照中的 hash */
  snapshotHash?: string;

  /** 原始变更类型 */
  originalChangeType?: string;
}

/**
 * WAL（Write-Ahead Log）条目
 * 用于进程崩溃恢复
 */
export interface WalEntry {
  /** WAL 记录 ID */
  id: string;

  /** 操作类型 */
  type: 'undo' | 'redo';

  /** 关联的轮次 */
  roundId: number;

  /** 文件总数 */
  totalFiles: number;

  /** 当前状态 */
  status: 'in_progress' | 'completed' | 'failed' | 'rolled_back';

  /** 开始时间 */
  startedAt: string;

  /** 完成时间 */
  completedAt?: string;
}

/**
 * 会话索引条目
 */
export interface SessionIndexEntry {
  /** 最新轮次编号 */
  roundId: number;

  /** 清单文件路径（null 表示无变更轮次） */
  manifestPath: string | null;

  /** 用户消息摘要 */
  userMessageSummary: string;

  /** 结束时间 */
  endedAt: string;

  /** 快照总大小 */
  totalSize: number;

  /** 快照状态 */
  status: SnapshotStatus;
}
