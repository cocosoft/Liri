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
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 撤消执行管理器
 *
 * 对应方案文档 §4 的撤消执行设计和 §5 的重做设计。
 * 功能：
 *   1. executeUndo — 执行撤消（含 WAL 崩溃恢复 + undoGuard 防护）
 *   2. previewUndo — 预览撤消效果
 *   3. wasModifiedInLaterRounds — 检测后续轮次冲突
 *   4. detectRedoConflicts — 检测重做冲突
 */

import {
  copyFile,
  rename,
  unlink,
  readFile,
  writeFile,
  readdir,
  stat,
  rm,
} from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { homedir } from 'os';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import {
  loadSnapshot,
  listSessionSnapshots,
  getSnapshotsRoot,
  getRoundDir,
} from './SnapshotStorage';
import { xxHash } from './xxHash';
import type {
  RoundSnapshot,
  FileChange,
  UndoResult,
  WalEntry,
  UndoGuardState,
  RedoConflict,
} from './types';
import type { FileOperationTracker } from './FileOperationTracker';

const logger = new Logger({ module: 'UndoManager' });

// ==================== WAL（Write-Ahead Log）管理 ====================

/**
 * 获取 WAL 存储目录
 */
function getWalDir(): string {
  return join(getSnapshotsRoot(), 'wal');
}

/**
 * WAL 存储
 */
const WalStore = {
  /**
   * 写入 WAL 记录
   */
  async write(entry: WalEntry): Promise<void> {
    const walDir = getWalDir();
    await import('fs/promises').then((fs) =>
      fs.mkdir(walDir, { recursive: true })
    );

    const walPath = join(walDir, `${entry.id}.wal.json`);
    await writeFile(walPath, JSON.stringify(entry, null, 2), 'utf-8');
  },

  /**
   * 更新 WAL 记录
   */
  async update(id: string, updates: Partial<WalEntry>): Promise<void> {
    const walPath = join(getWalDir(), `${id}.wal.json`);
    try {
      const content = await readFile(walPath, 'utf-8');
      const entry: WalEntry = JSON.parse(content);
      Object.assign(entry, updates);
      await writeFile(walPath, JSON.stringify(entry, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('更新 WAL 记录失败', { id });
    }
  },

  /**
   * 查找所有未完成的 WAL 记录
   */
  async findPending(): Promise<WalEntry[]> {
    const walDir = getWalDir();
    if (!existsSync(walDir)) return [];

    const files = await readdir(walDir);
    const pending: WalEntry[] = [];

    for (const file of files) {
      if (!file.endsWith('.wal.json')) continue;
      try {
        const content = await readFile(join(walDir, file), 'utf-8');
        const entry: WalEntry = JSON.parse(content);
        if (entry.status === 'in_progress') {
          pending.push(entry);
        }
      } catch (err) {
        // 跳过损坏的 WAL 文件
      }
    }

    return pending;
  },
};

// ==================== UndoGuard（撤消保护） ====================

/**
 * 获取 undoGuard 存储目录
 */
function getUndoGuardDir(): string {
  return join(getSnapshotsRoot(), 'undo_guards');
}

/**
 * 创建撤消保护快照
 * 在撤消前备份当前文件状态，防止撤消失败后无法恢复
 *
 * 对应方案文档 §4.3 的 createUndoGuard 设计
 */
async function createUndoGuard(
  snapshot: RoundSnapshot
): Promise<UndoGuardState> {
  const guardDir = join(
    getUndoGuardDir(),
    `R${snapshot.roundId}_${Date.now()}`
  );
  await import('fs/promises').then((fs) =>
    fs.mkdir(guardDir, { recursive: true })
  );

  const preState: FileChange[] = [];

  for (const change of snapshot.changedFiles) {
    if (change.type === 'created') {
      // created 文件在撤消时会被删除，不需要备份
      preState.push({
        path: change.path,
        type: 'modified', // 保护快照中使用 modified 表示"这里有文件"
        hash: await xxHash(change.path).catch(() => undefined),
      });
      continue;
    }

    // 备份当前文件（撤消前的状态）
    const currentPath = change.oldPath || change.path;
    if (existsSync(currentPath)) {
      const currentHash = await xxHash(currentPath).catch(() => undefined);
      const guardBackupPath = join(
        guardDir,
        `guard_${encodeURIComponent(currentPath.replace(/[/\\]/g, '_'))}`
      );

      try {
        await copyFile(currentPath, guardBackupPath);
        preState.push({
          path: currentPath,
          type: change.type,
          backupPath: guardBackupPath,
          hash: currentHash,
        });
      } catch (error) {
        logger.warn('创建 undoGuard 备份失败', {
          path: currentPath,
          error: String(error),
        });
      }
    }
  }

  logger.info('undoGuard 已创建', {
    roundId: snapshot.roundId,
    files: preState.length,
  });

  return {
    roundId: snapshot.roundId,
    preState,
    hasBeenRolledBack: false,
  };
}

/**
 * 加载 undoGuard
 */
async function loadUndoGuard(roundId: number): Promise<UndoGuardState | null> {
  const guardDir = getUndoGuardDir();
  if (!existsSync(guardDir)) return null;

  try {
    const dirs = await readdir(guardDir);
    const matchingDir = dirs.find((d) => d.startsWith(`R${roundId}_`));
    if (!matchingDir) return null;

    const guardPath = join(guardDir, matchingDir);

    // 从目录中恢复 preState
    const files = await readdir(guardPath);
    const preState: FileChange[] = [];

    for (const file of files) {
      const filePath = join(guardPath, file);
      const originalPath = decodeURIComponent(
        file.replace('guard_', '').replace(/_/g, '/')
      );

      preState.push({
        path: originalPath,
        type: 'modified',
        backupPath: filePath,
      });
    }

    return {
      roundId,
      preState,
      hasBeenRolledBack: false,
    };
  } catch (err) {
    return null;
  }
}

// ==================== 后续轮次冲突检测 ====================

/**
 * 检测文件是否在后续轮次中被修改过
 * 用于撤消操作的保护检查
 */
async function wasModifiedInLaterRounds(
  filePath: string,
  currentRoundId: number,
  sessionId: string
): Promise<boolean> {
  const snapshots = await listSessionSnapshots(sessionId);

  // 只检查比当前轮次新的快照
  const laterSnapshots = snapshots.filter((s) => s.roundId > currentRoundId);

  for (const snapshot of laterSnapshots) {
    for (const change of snapshot.changedFiles) {
      const affectedPath = change.oldPath || change.newPath || change.path;
      if (affectedPath === filePath) {
        return true;
      }
    }
  }

  return false;
}

// ==================== R3: 用户修改检测 ====================

/**
 * 检测用户在 AI 操作后手动修改的文件
 *
 * 对比快照中记录的 hash 与当前文件 hash，识别用户手动修改。
 * 用于撤消前保护用户修改不被覆盖。
 *
 * @param snapshot 要检测的快照
 * @returns 被用户手动修改的文件路径列表
 */
export async function detectUserModifications(
  snapshot: RoundSnapshot
): Promise<string[]> {
  const userModifiedFiles: string[] = [];

  for (const change of snapshot.changedFiles) {
    const checkPath = change.oldPath || change.path;

    if (existsSync(checkPath) && change.hash) {
      const currentHash = await xxHash(checkPath).catch(() => '');

      if (currentHash && currentHash !== change.hash) {
        userModifiedFiles.push(checkPath);
      }
    }
  }

  return userModifiedFiles;
}

// ==================== R2: 级联撤消依赖检测 ====================

/**
 * 查找依赖于指定轮次的后续轮次
 *
 * 级联撤消的核心算法：收集目标轮次中所有受影响文件，逐轮检查后续轮次
 * 是否操作了这些文件。如果后续轮次依赖了目标轮次的文件，则在撤消目标
 * 轮次时必须同时撤消这些依赖轮次。
 *
 * @param sessionId 会话 ID
 * @param targetRoundId 目标轮次编号
 * @returns 依赖本轮的后续轮次编号数组（升序排列）
 */
export async function findDependentRounds(
  sessionId: string,
  targetRoundId: number
): Promise<number[]> {
  const targetSnapshot = await loadSnapshot(sessionId, targetRoundId);
  if (!targetSnapshot) return [];

  // 收集目标轮次中所有受影响文件路径
  const affectedPaths = new Set<string>();
  for (const change of targetSnapshot.changedFiles) {
    const path = change.oldPath || change.newPath || change.path;
    affectedPaths.add(path);
  }

  // 按轮次升序获取后续快照
  const laterSnapshots = (await listSessionSnapshots(sessionId))
    .filter((s) => s.roundId > targetRoundId)
    .sort((a, b) => a.roundId - b.roundId);

  const dependentRounds: number[] = [];

  for (const laterSnapshot of laterSnapshots) {
    let hasDependency = false;

    for (const laterChange of laterSnapshot.changedFiles) {
      const laterPath =
        laterChange.oldPath || laterChange.newPath || laterChange.path;

      if (affectedPaths.has(laterPath)) {
        hasDependency = true;

        // 将本轮的受影响文件也加入集合，形成传递依赖链
        // 例如：R1 改 a.txt → R2 改 a.txt → R3 改 a.txt（撤消 R1 需级联撤消 R2 和 R3）
        affectedPaths.add(laterPath);
        break;
      }
    }

    if (hasDependency) {
      dependentRounds.push(laterSnapshot.roundId);
    }
  }

  return dependentRounds;
}

/**
 * 清理级联撤消后产生的孤立文件
 *
 * 当一个轮次创建了文件 B，后续轮次修改了 B，撤消时需要：
 *   1. 撤消后续轮次（恢复 B 到轮次创建时的状态）
 *   2. 撤消创建轮次（删除 B）
 *
 * 此函数清理级联撤消完成后不再被任何快照引用的孤立备份文件。
 *
 * @param cascadedRounds 已撤消的级联轮次列表
 * @param sessionId 会话 ID
 */
export async function cleanupOrphanFiles(
  cascadedRounds: number[],
  sessionId: string
): Promise<{ cleaned: number }> {
  let cleaned = 0;

  for (const roundId of cascadedRounds) {
    const snapshot = await loadSnapshot(sessionId, roundId);
    if (!snapshot) continue;

    for (const change of snapshot.changedFiles) {
      // 清理不再需要的 backupPath 文件
      if (change.backupPath && existsSync(change.backupPath)) {
        try {
          await unlink(change.backupPath);
          cleaned++;
        } catch (err) {
          // 文件可能已被其他操作清理
        }
      }

      // 清理不再需要的 afterBackupPath 文件
      if (change.afterBackupPath && existsSync(change.afterBackupPath)) {
        try {
          await unlink(change.afterBackupPath);
          cleaned++;
        } catch (err) {
          // 文件可能已被其他操作清理
        }
      }

      // 清理 renamed 操作的 newPath 文件（撤消后已重命名回 oldPath）
      if (
        change.type === 'renamed' &&
        change.newPath &&
        existsSync(change.newPath)
      ) {
        try {
          await unlink(change.newPath);
          cleaned++;
        } catch (err) {
          // 文件可能已被其他操作清理
        }
      }
    }
  }

  return { cleaned };
}

// ==================== 撤消预览 ====================

/**
 * 预览撤消效果
 * 在真正执行撤消前展示给用户看
 */
export async function previewUndo(
  sessionId: string,
  roundId: number
): Promise<{
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
  const snapshot = await loadSnapshot(sessionId, roundId);

  if (!snapshot) {
    return {
      snapshot: null,
      summary: {
        totalFiles: 0,
        restoredFiles: 0,
        revertedFiles: 0,
        removedFiles: 0,
        skippedUserModified: 0,
        userModifiedFiles: [],
      },
    };
  }

  // 检测用户手动修改的文件
  const userModifiedFiles: string[] = [];
  for (const change of snapshot.changedFiles) {
    const checkPath = change.oldPath || change.path;
    if (existsSync(checkPath) && change.hash) {
      const currentHash = await xxHash(checkPath).catch(() => '');
      if (currentHash && currentHash !== change.hash) {
        userModifiedFiles.push(checkPath);
      }
    }
  }

  const summary = {
    totalFiles: snapshot.changedFiles.length,
    restoredFiles: snapshot.changedFiles.filter((c) => c.type === 'deleted')
      .length,
    revertedFiles: snapshot.changedFiles.filter(
      (c) => c.type === 'modified' || c.type === 'moved' || c.type === 'renamed'
    ).length,
    removedFiles: snapshot.changedFiles.filter((c) => c.type === 'created')
      .length,
    skippedUserModified: userModifiedFiles.length,
    userModifiedFiles,
  };

  return { snapshot, summary };
}

// ==================== 撤消执行 ====================

/**
 * 执行撤消
 * 对应方案文档 §4.3 的 executeUndo 设计
 *
 * 执行流程：
 *   Step 0: 写入 WAL + 创建 undoGuard
 *   Step 1: 检测用户手动修改（不覆盖）
 *   Step 2: 按类型分组处理（deleted → 恢复，modified/moved → 回退，renamed → 移回，created → 删除）
 *   Step 3: 检查后续轮次冲突
 *   Step 4: 完成 WAL，清理
 */
export async function executeUndo(
  sessionId: string,
  roundId: number
): Promise<UndoResult> {
  const snapshot = await loadSnapshot(sessionId, roundId);
  if (!snapshot) throw new Error(`快照 R${roundId} 不存在`);

  // Step 0a: 写入 WAL
  const walId = `undo_R${roundId}_${Date.now()}`;
  await WalStore.write({
    id: walId,
    type: 'undo',
    roundId,
    totalFiles: snapshot.changedFiles.length,
    status: 'in_progress',
    startedAt: new Date().toISOString(),
  });

  // Step 0b: 创建撤消保护快照
  const undoGuardState = await createUndoGuard(snapshot);

  try {
    // Step 1: 检测用户手动修改（不覆盖）
    const userModifiedPaths = new Set<string>();
    for (const change of snapshot.changedFiles) {
      const checkPath = change.oldPath || change.path;
      if (existsSync(checkPath) && change.hash) {
        const currentHash = await xxHash(checkPath).catch(() => '');
        if (currentHash && currentHash !== change.hash) {
          userModifiedPaths.add(checkPath);
        }
      }
    }

    // 级联撤消检测：找到依赖本轮的后续轮次
    const cascadedRounds: number[] = [];
    const laterSnapshots = (await listSessionSnapshots(sessionId))
      .filter((s) => s.roundId > roundId)
      .sort((a, b) => a.roundId - b.roundId);

    for (const laterSnapshot of laterSnapshots) {
      let hasDependency = false;
      for (const laterChange of laterSnapshot.changedFiles) {
        const laterPath =
          laterChange.oldPath || laterChange.newPath || laterChange.path;
        for (const currentChange of snapshot.changedFiles) {
          const currentPath =
            currentChange.oldPath ||
            currentChange.newPath ||
            currentChange.path;
          if (laterPath === currentPath) {
            hasDependency = true;
            break;
          }
        }
        if (hasDependency) break;
      }
      if (hasDependency) {
        cascadedRounds.push(laterSnapshot.roundId);
      }
    }

    // Step 2: 按变更类型分组处理
    const results = {
      restoredFiles: 0,
      revertedFiles: 0,
      removedFiles: 0,
      skippedUserModified: 0,
    };

    const failures: string[] = [];

    // 处理 deleted 文件（恢复）
    for (const change of snapshot.changedFiles.filter(
      (c) => c.type === 'deleted'
    )) {
      const checkPath = change.oldPath || change.path;
      if (userModifiedPaths.has(checkPath)) {
        results.skippedUserModified++;
        continue;
      }
      if (change.backupPath && existsSync(change.backupPath)) {
        try {
          await copyFile(change.backupPath, checkPath);
          results.restoredFiles++;
        } catch (error) {
          logger.warn('撤消：恢复文件失败', {
            path: checkPath,
            error: String(error),
          });
          failures.push(`恢复 ${checkPath} 失败: ${error}`);
        }
      }
    }

    // 处理 modified + moved 文件（恢复备份）
    for (const change of snapshot.changedFiles.filter(
      (c) => c.type === 'modified' || c.type === 'moved'
    )) {
      const targetPath = change.oldPath || change.path;
      if (userModifiedPaths.has(targetPath)) {
        results.skippedUserModified++;
        continue;
      }
      if (change.backupPath && existsSync(change.backupPath)) {
        try {
          await copyFile(change.backupPath, targetPath);
          results.revertedFiles++;
        } catch (error) {
          logger.warn('撤消：回退文件失败', {
            path: targetPath,
            error: String(error),
          });
          failures.push(`回退 ${targetPath} 失败: ${error}`);
        }
      }
    }

    // 处理 renamed 文件（恢复旧路径）
    for (const change of snapshot.changedFiles.filter(
      (c) => c.type === 'renamed'
    )) {
      if (change.newPath && change.oldPath && existsSync(change.newPath)) {
        try {
          await rename(change.newPath, change.oldPath);
          results.revertedFiles++;
        } catch (error) {
          logger.warn('撤消：重命名恢复失败', {
            newPath: change.newPath,
            oldPath: change.oldPath,
            error: String(error),
          });
          failures.push(
            `重命名恢复 ${change.newPath} → ${change.oldPath} 失败: ${error}`
          );
        }
      }
    }

    // 处理 created 文件（删除）
    for (const change of snapshot.changedFiles.filter(
      (c) => c.type === 'created'
    )) {
      const modifiedLater = await wasModifiedInLaterRounds(
        change.path,
        roundId,
        sessionId
      );
      if (modifiedLater) {
        // 被后续轮次修改过，跳过删除
        logger.warn('created 文件被后续轮次修改，跳过删除', {
          path: change.path,
          roundId,
        });
        continue;
      }
      if (existsSync(change.path)) {
        try {
          await unlink(change.path);
          results.removedFiles++;
        } catch (error) {
          logger.warn('撤消：删除文件失败', {
            path: change.path,
            error: String(error),
          });
          failures.push(`删除 ${change.path} 失败: ${error}`);
        }
      }
    }

    // Step 3: 完成 WAL
    await WalStore.update(walId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
    });

    logger.info('撤消完成', {
      roundId,
      ...results,
      cascadedRounds: cascadedRounds.length,
      failures: failures.length,
    });

    return {
      success: failures.length === 0,
      ...results,
      cascadedRounds,
      failures,
    };
  } catch (error) {
    // 撤消过程中出错，尝试回滚 undoGuard
    logger.error('撤消失败，尝试回滚', { roundId, error: String(error) });
    handleError(error, {
      module: 'UndoManager',
      action: 'executeUndo',
      context: { roundId, sessionId, walId },
    }).catch(() => {});

    await WalStore.update(walId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
    });

    // 🔴 Liri v6: 使用副本避免 reverse() 原地变异问题
    if (!undoGuardState.hasBeenRolledBack) {
      const orderedItems = [...undoGuardState.preState].reverse();
      for (const item of orderedItems) {
        if (item.backupPath && existsSync(item.backupPath)) {
          try {
            await copyFile(item.backupPath, item.path);
          } catch (rollbackError) {
            logger.error('undoGuard 回滚失败', {
              path: item.path,
              error: String(rollbackError),
            });
          }
        }
      }
      undoGuardState.hasBeenRolledBack = true;
    }

    throw error;
  }
}

// ==================== 重做冲突检测 ====================

/**
 * 重做冲突检测
 * 在重做前检查目标快照中每个受影响的文件是否被后续轮次修改过
 *
 * 对应方案文档 §5.3 的 detectRedoConflicts 设计
 *
 * 检测范围：
 *   - deleted 类型：检查文件路径是否被后续轮次创建或修改
 *   - modified/created 类型：检查文件路径是否被后续轮次修改
 *   - renamed/moved 类型：检查 oldPath 和 newPath 是否被后续轮次操作
 */
export async function detectRedoConflicts(
  snapshot: RoundSnapshot
): Promise<RedoConflict[]> {
  const conflicts: RedoConflict[] = [];

  for (const change of snapshot.changedFiles) {
    // 收集需要检查的路径
    const affectedPaths: string[] = [];

    if (change.type === 'renamed' && change.newPath) {
      // renamed：撤消后文件回到 oldPath，重做需移回 newPath
      affectedPaths.push(change.newPath);
    } else if (change.type === 'moved' && change.newPath) {
      // moved：撤消后文件从 backupPath 恢复到 oldPath，重做需复制到 newPath
      affectedPaths.push(change.newPath);
    } else if (change.type !== 'deleted') {
      // modified/created：直接检查文件路径
      affectedPaths.push(change.path);
    } else {
      // deleted：检查路径是否被后续轮次重新创建
      affectedPaths.push(change.path);
    }

    for (const targetPath of affectedPaths) {
      const modifiedLater = await wasModifiedInLaterRounds(
        targetPath,
        snapshot.roundId,
        snapshot.sessionId
      );

      if (modifiedLater) {
        const currentHash = await xxHash(targetPath).catch(() => undefined);

        conflicts.push({
          path: targetPath,
          reason: 'file_modified_in_later_round',
          currentHash,
          snapshotHash: change.hash,
          originalChangeType: change.type,
        });
      }
    }
  }

  return conflicts;
}

// ==================== 崩溃恢复 ====================

/**
 * 恢复崩溃时未完成的撤消操作
 * 在应用启动时调用
 */
export async function recoverFromCrash(): Promise<void> {
  const pending = await WalStore.findPending();

  for (const entry of pending) {
    if (Date.now() - new Date(entry.startedAt).getTime() > 60_000) {
      // 超过 60 秒的 in_progress 记录视为崩溃
      const guard = await loadUndoGuard(entry.roundId);
      if (guard && !guard.hasBeenRolledBack) {
        // 使用副本避免 reverse() 原地变异
        const orderedItems = [...guard.preState].reverse();
        for (const item of orderedItems) {
          if (item.backupPath && existsSync(item.backupPath)) {
            try {
              await copyFile(item.backupPath, item.path);
            } catch (error) {
              logger.error('崩溃恢复回滚失败', {
                path: item.path,
                error: String(error),
              });
              handleError(error, {
                module: 'UndoManager',
                action: 'recoverFromCrash:undoGuard',
                context: {
                  path: item.path,
                  backupPath: item.backupPath,
                  roundId: entry.roundId,
                },
              }).catch(() => {});
            }
          }
        }
        guard.hasBeenRolledBack = true;
      }

      await WalStore.update(entry.id, {
        status: 'rolled_back',
        completedAt: new Date().toISOString(),
      });

      logger.warn('检测到未完成的撤消操作，已自动回滚', {
        roundId: entry.roundId,
        walId: entry.id,
      });
    }
  }
}
