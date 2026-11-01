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
 * 回滚系统集成层
 *
 * 将回滚系统接入 ChatManager 的工具执行流程。
 * 提供钩子函数，在 AI 对话的工具执行生命周期中调用：
 *
 *   ┌──────────────────────────────────────────────────┐
 *   │  1. onRoundStart()                               │
 *   │     └─ FileOperationTracker.recordRoundStart()   │
 *   │                                                  │
 *   │  2. onToolBeforeExecute()  (每工具调用)           │
 *   │     └─ FileOperationTracker.beforeToolOperation() │
 *   │                                                  │
 *   │  3. onRoundEnd()                                 │
 *   │     ├─ FileOperationTracker.detectShellSideEffects│
 *   │     ├─ SnapshotStorage.createRoundSnapshot()      │
 *   │     └─ SnapshotStorage.updateSessionIndex()       │
 *   └──────────────────────────────────────────────────┘
 *
 * 使用示例：
 *   const integration = new RollbackIntegration(sessionId);
 *   await integration.onRoundStart(sessionId, roundId, [workspacePath]);
 *   // ... 执行工具 ...
 *   await integration.onToolBeforeExecute({ path, type: 'modified', ... });
 *   await integration.onRoundEnd(messageSummary);
 */

import { getLogger } from '@modules/monitoring';
import { FileOperationTracker } from './FileOperationTracker';
import {
  createRoundSnapshot,
  updateSessionIndex,
  loadSnapshot,
  deleteRoundSnapshot,
} from './SnapshotStorage';
import { onApplicationStart } from './CleanupManager';
import { executeUndo, previewUndo, findDependentRounds } from './UndoManager';
import { executeRedo, canRedo } from './RedoManager';
import { generateUndoContext, shouldInjectContext } from './AIContextInjector';
import type { FileOperation } from './FileOperationTracker';
import type {
  FileChange,
  UndoResult,
  ScanStatus,
  SessionIndexEntry,
  RoundSnapshot,
  RedoConflict,
} from './types';
import type { RedoResult } from './RedoManager';

const logger = getLogger('RollbackIntegration');

/**
 * 撤消/重做权限检查函数类型
 *
 * 返回 { allowed: true } 表示允许，{ allowed: false, reason } 表示拒绝。
 * 不设置权限检查器时，默认允许所有操作（向后兼容）。
 */
export type RollbackPermissionCheckFn = (
  action: 'undo' | 'redo',
  roundId: number
) => Promise<{ allowed: boolean; reason?: string }>;

/**
 * 回滚系统集成器
 *
 * 管理从 AI 工具执行到快照创建的全生命周期。
 * 每个会话实例对应一个 RollbackIntegration 实例。
 */
export class RollbackIntegration {
  /** 文件操作追踪器实例 */
  private tracker: FileOperationTracker;

  /** 当前会话 ID */
  private sessionId: string;

  /** 当前轮次编号 */
  private currentRoundId: number = 0;

  /** 是否已初始化 */
  private initialized: boolean = false;

  /** 扫描路径（用于 Shell 副作用检测） */
  private scanPaths: string[] = [];

  /** 撤消/重做权限检查器（可选） */
  private permissionChecker: RollbackPermissionCheckFn | null = null;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.tracker = new FileOperationTracker();
  }

  /**
   * 设置撤消/重做权限检查器
   *
   * 设置后，每次执行 undoRound / redoRound 前都会调用此函数。
   * 不设置则默认允许所有撤消/重做操作（向后兼容）。
   *
   * @param checker 权限检查函数
   */
  setPermissionChecker(checker: RollbackPermissionCheckFn | null): void {
    this.permissionChecker = checker;
  }

  /**
   * 应用启动时调用——清理中断轮次 + 配额管理
   */
  static async onAppStart(): Promise<void> {
    await onApplicationStart();
  }

  /**
   * 轮次开始时调用
   *
   * 必须在 onToolBeforeExecute 之前调用。
   *
   * @param sessionId 会话 ID
   * @param roundId 轮次编号
   * @param scanPaths 需要扫描的目录路径（用于 Shell 副作用检测）
   */
  async onRoundStart(
    sessionId: string,
    roundId: number,
    scanPaths: string[]
  ): Promise<void> {
    this.sessionId = sessionId;
    this.currentRoundId = roundId;
    this.scanPaths = scanPaths;

    // 重置追踪器
    this.tracker.reset();

    // 记录轮次开始时的文件系统快照
    await this.tracker.recordRoundStart(scanPaths);
    this.initialized = true;

    logger.info('回滚：轮次开始', { sessionId, roundId, scanPaths });
  }

  /**
   * 在文件工具执行前调用
   *
   * 记录文件的"操作前状态"，用于后续撤消。
   *
   * @param operation 文件操作描述
   */
  async onToolBeforeExecute(operation: FileOperation): Promise<void> {
    if (!this.initialized) {
      logger.warn('onToolBeforeExecute 在 onRoundStart 之前调用，跳过追踪', {
        path: operation.path,
      });
      return;
    }

    await this.tracker.beforeToolOperation(operation);
  }

  /**
   * 轮次结束时调用
   *
   * 执行最终化流程：
   *   1. detectShellSideEffects — 检测 Shell 副作用
   *   2. createRoundSnapshot — 创建快照
   *   3. updateSessionIndex — 更新会话索引
   *
   * @param messageSummary 用户消息摘要
   * @returns 创建的快照（若无变更返回 null）
   */
  async onRoundEnd(messageSummary: string): Promise<RoundSnapshot | null> {
    if (!this.initialized) {
      logger.warn('onRoundEnd 在 onRoundStart 之前调用，跳过快照创建');
      return null;
    }

    // Step 1: 检测 Shell 副作用
    const { scanStatus } = await this.tracker.detectShellSideEffects();

    // Step 2: 获取变更列表
    const changes = this.tracker.getChanges();

    if (changes.length === 0) {
      logger.info('回滚：本轮无文件变更，跳过快照', {
        sessionId: this.sessionId,
        roundId: this.currentRoundId,
      });
      this.initialized = false;
      return null;
    }

    // Step 3: 创建快照
    const snapshot = await createRoundSnapshot(
      this.sessionId,
      this.currentRoundId,
      messageSummary,
      changes,
      scanStatus,
      true // storeAfterVersion = true（支持重做）
    );

    // Step 4: 更新会话索引
    const indexEntry: SessionIndexEntry = {
      roundId: this.currentRoundId,
      manifestPath: null, // 不使用索引路径
      userMessageSummary: messageSummary.slice(0, 100),
      endedAt: new Date().toISOString(),
      totalSize: snapshot.totalSize,
      status: 'active',
    };

    await updateSessionIndex(this.sessionId, indexEntry);

    logger.info('回滚：轮次结束，快照已创建', {
      sessionId: this.sessionId,
      roundId: this.currentRoundId,
      changedFiles: changes.length,
      scanStatus,
    });

    this.initialized = false;
    return snapshot;
  }

  /**
   * 检查撤消/重做权限
   *
   * @param action 操作类型
   * @param roundId 目标轮次
   * @throws 权限拒绝时抛出错误
   */
  private async _checkPermission(
    action: 'undo' | 'redo',
    roundId: number
  ): Promise<void> {
    if (!this.permissionChecker) return;

    const result = await this.permissionChecker(action, roundId);
    if (!result.allowed) {
      logger.warn(`回滚：${action} 权限被拒绝`, {
        sessionId: this.sessionId,
        roundId,
        reason: result.reason,
      });
      throw new Error(
        `回滚权限被拒绝：${result.reason || `${action} 操作未被授权`}`
      );
    }
  }

  /**
   * 撤消指定轮次
   *
   * @param roundId 目标轮次
   * @returns 撤消结果
   */
  async undoRound(roundId: number): Promise<UndoResult> {
    await this._checkPermission('undo', roundId);
    return executeUndo(this.sessionId, roundId);
  }

  /**
   * 重做指定轮次
   *
   * @param roundId 目标轮次
   * @returns 重做结果
   */
  async redoRound(roundId: number): Promise<RedoResult> {
    await this._checkPermission('redo', roundId);
    return executeRedo(this.sessionId, roundId);
  }

  /**
   * 预览撤消效果
   *
   * @param roundId 目标轮次
   * @returns 预览结果
   */
  async previewUndoRound(roundId: number): Promise<{
    snapshot: RoundSnapshot | null;
    summary: {
      totalFiles: number;
      restoredFiles: number;
      revertedFiles: number;
      removedFiles: number;
      skippedUserModified: number;
      userModifiedFiles: string[];
    };
  }> {
    return previewUndo(this.sessionId, roundId);
  }

  /**
   * 获取级联依赖的后续轮次
   *
   * @param roundId 目标轮次
   * @returns 依赖轮次列表
   */
  async getDependentRounds(roundId: number): Promise<number[]> {
    return findDependentRounds(this.sessionId, roundId);
  }

  /**
   * 检查可重做
   *
   * @param roundId 轮次编号
   * @returns 是否可重做
   */
  async canRedoRound(roundId: number): Promise<boolean> {
    return canRedo(this.sessionId, roundId);
  }

  /**
   * 获取 AI 上下文注入文本
   *
   * @param maxRounds 最多包含的轮次数
   * @returns 上下文文本
   */
  async getUndoContext(maxRounds: number = 3): Promise<string> {
    return generateUndoContext(this.sessionId, maxRounds);
  }

  /**
   * 判断是否需要注入撤消上下文
   *
   * @returns 是否需要注入
   */
  async shouldInjectContext(): Promise<boolean> {
    return shouldInjectContext(this.sessionId);
  }

  /**
   * 获取快照
   *
   * @param roundId 轮次编号
   * @returns 快照或 null
   */
  async getSnapshot(roundId: number): Promise<RoundSnapshot | null> {
    return loadSnapshot(this.sessionId, roundId);
  }

  /**
   * 删除快照
   *
   * @param roundId 轮次编号
   */
  async deleteSnapshot(roundId: number): Promise<void> {
    return deleteRoundSnapshot(this.sessionId, roundId);
  }

  /**
   * 获取当前追踪的变更列表
   *
   * @returns 变更列表
   */
  getCurrentChanges(): FileChange[] {
    return this.tracker.getChanges();
  }

  /**
   * 合并外部变更记录到当前轮次（子 Agent 操作继承）
   *
   * 子 Agent 的 Shell 副作用检测结果合并到父会话的 FileOperationTracker，
   * 确保父会话回退时一并撤消子 Agent 创建/删除的文件。
   *
   * @param externalChanges 外部变更记录
   */
  mergeChanges(externalChanges: FileChange[]): void {
    this.tracker.mergeChanges(externalChanges);
  }

  /**
   * 获取无法精确恢复的文件列表
   *
   * @returns 无法恢复的文件列表
   */
  getUnrestorableFiles(): FileChange[] {
    return this.tracker.getUnrestorableFiles();
  }

  /**
   * 获取当前变更数量
   */
  get changeCount(): number {
    return this.tracker.changeCount;
  }

  /**
   * 获取当前扫描状态
   */
  get scanStatus(): ScanStatus {
    return this.tracker.scanStatus;
  }
}
