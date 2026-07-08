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
 * 重做管理器
 *
 * 负责执行重做操作（撤消的反向操作）。
 * 对应方案文档 §5 的重做设计。
 *
 * 重做流程：
 *   1. 加载目标快照（包含撤消前保存的原始状态）
 *   2. 检测重做冲突（被后续轮次修改的文件）
 *   3. 按变更类型反向恢复
 *   4. WAL 记录 + 崩溃保护
 */

import {
  copyFile,
  rename,
  unlink,
  writeFile,
  readFile,
  readdir,
} from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { loadSnapshot, getSnapshotsRoot } from './SnapshotStorage';
import { xxHash } from './xxHash';
import type {
  RoundSnapshot,
  FileChange,
  RedoConflict,
  WalEntry,
} from './types';

const logger = new Logger({ module: 'RedoManager' });

// ==================== WAL 管理（与 UndoManager 共享 WAL 目录） ====================

/** WAL 文件前缀 */
const WAL_PREFIX = 'redo';

/**
 * 获取 WAL 目录
 */
function getWalDir(): string {
  return join(getSnapshotsRoot(), 'wal');
}

/**
 * 写入 WAL 记录
 */
async function writeWal(entry: WalEntry): Promise<void> {
  const walDir = getWalDir();
  await import('fs/promises').then((fs) =>
    fs.mkdir(walDir, { recursive: true })
  );

  const walPath = join(walDir, `${entry.id}.wal.json`);
  await writeFile(walPath, JSON.stringify(entry, null, 2), 'utf-8');
}

/**
 * 更新 WAL 状态
 */
async function updateWal(
  id: string,
  updates: Partial<WalEntry>
): Promise<void> {
  const walPath = join(getWalDir(), `${id}.wal.json`);
  try {
    const content = await readFile(walPath, 'utf-8');
    const entry: WalEntry = JSON.parse(content);
    Object.assign(entry, updates);
    await writeFile(walPath, JSON.stringify(entry, null, 2), 'utf-8');
  } catch {
    logger.warn('更新重做 WAL 记录失败', { id });
  }
}

// ==================== 重做冲突检测（引用 UndoManager 中的 detectRedoConflicts） ====================

// detectRedoConflicts 已在 UndoManager.ts 中实现，此处直接引用。
// 重做前的冲突检测逻辑与撤消前的冲突检测相同。

// ==================== 重做执行 ====================

/**
 * 重做操作结果
 */
export interface RedoResult {
  /** 是否全部成功 */
  success: boolean;

  /** 已重新创建的文件数（对应撤消中的 deleted 类型恢复） */
  recreatedFiles: number;

  /** 已重新应用修改的文件数（对应撤消中的 modified 回退逆转） */
  reappliedFiles: number;

  /** 已重新删除的文件数（对应撤消中的 created 类型删除逆转） */
  removedFiles: number;

  /** 因冲突跳过的文件数 */
  skippedConflicts: number;

  /** 失败列表 */
  failures: string[];
}

/**
 * 执行重做
 *
 * 重做是撤消的逆操作。目标快照中的 FileChange 记录了：
 *   - backupPath: 撤消前的旧文件备份（用于撤消恢复）
 *   - afterBackupPath: AI 修改后的文件备份（用于重做恢复）
 *
 * 重做处理逻辑（按类型）：
 *   created → 撤消时删除了文件 → 重做：重新创建
 *   deleted → 撤消时恢复了文件 → 重做：重新删除
 *   modified → 撤消时恢复了旧版本 → 重做：恢复 AI 修改版本
 *   renamed → 撤消时移回了 oldPath → 重做：移回 newPath
 *   moved   → 撤消时移回了 oldPath → 重做：移回 newPath
 *
 * @param sessionId 会话 ID
 * @param roundId 目标轮次
 * @param skipConflicts 是否跳过冲突文件（默认 true）
 * @returns 重做结果
 */
export async function executeRedo(
  sessionId: string,
  roundId: number,
  skipConflicts: boolean = true
): Promise<RedoResult> {
  const snapshot = await loadSnapshot(sessionId, roundId);
  if (!snapshot) throw new Error(`快照 R${roundId} 不存在`);

  // 检查快照是否需要 storeAfterVersion
  if (!snapshot.storeAfterVersion) {
    throw new Error(
      `快照 R${roundId} 未存储修改后版本（storeAfterVersion = false），无法重做`
    );
  }

  // 写入 WAL
  const walId = `${WAL_PREFIX}_R${roundId}_${Date.now()}`;
  await writeWal({
    id: walId,
    type: 'redo',
    roundId,
    totalFiles: snapshot.changedFiles.length,
    status: 'in_progress',
    startedAt: new Date().toISOString(),
  });

  try {
    // 冲突检测（引用自 UndoManager）
    const { detectRedoConflicts: detectConflicts } =
      await import('./UndoManager');
    const conflicts = await detectConflicts(snapshot);

    const conflictPaths = new Set(conflicts.map((c) => c.path));

    // 按类型分组处理
    let recreatedFiles = 0;
    let reappliedFiles = 0;
    let removedFiles = 0;
    const failures: string[] = [];

    for (const change of snapshot.changedFiles) {
      // 跳过冲突文件
      if (skipConflicts && conflictPaths.has(change.path)) {
        logger.warn('跳过冲突文件', { path: change.path, roundId });
        continue;
      }

      try {
        await processRedoChange(change);
        switch (change.type) {
          case 'created':
            recreatedFiles++;
            break;
          case 'deleted':
            removedFiles++;
            break;
          case 'modified':
          case 'renamed':
          case 'moved':
            reappliedFiles++;
            break;
        }
      } catch (error) {
        logger.warn('重做：文件操作失败', {
          path: change.path,
          type: change.type,
          error: String(error),
        });
        failures.push(`${change.path}: ${error}`);
      }
    }

    // 完成 WAL
    await updateWal(walId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
    });

    logger.info('重做完成', {
      roundId,
      recreatedFiles,
      reappliedFiles,
      removedFiles,
      failures: failures.length,
    });

    return {
      success: failures.length === 0,
      recreatedFiles,
      reappliedFiles,
      removedFiles,
      skippedConflicts: conflictPaths.size,
      failures,
    };
  } catch (error) {
    logger.error('重做执行失败', { roundId, sessionId, error: String(error) });
    handleError(error, {
      module: 'RedoManager',
      action: 'executeRedo',
      context: { roundId, sessionId, walId },
    }).catch(() => {});

    await updateWal(walId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
    });
    throw error;
  }
}

/**
 * 处理单个文件的重做操作
 */
async function processRedoChange(change: FileChange): Promise<void> {
  switch (change.type) {
    case 'created': {
      // 撤消时删除了这个文件 → 重做：用 afterBackupPath 恢复
      if (change.afterBackupPath && existsSync(change.afterBackupPath)) {
        await copyFile(change.afterBackupPath, change.path);
      } else if (change.backupPath && existsSync(change.backupPath)) {
        // 没有 afterBackupPath 时尝试用 backupPath
        await copyFile(change.backupPath, change.path);
      } else {
        throw new Error(`无法恢复已创建文件: ${change.path}（无备份）`);
      }
      break;
    }

    case 'deleted': {
      // 撤消时恢复了文件 → 重做：重新删除
      if (existsSync(change.path)) {
        await unlink(change.path);
      }
      break;
    }

    case 'modified': {
      // 撤消时恢复了旧版本 → 重做：恢复 AI 修改版本
      const sourcePath = change.afterBackupPath || change.backupPath;
      if (sourcePath && existsSync(sourcePath)) {
        await copyFile(sourcePath, change.path);
      } else if (change.newPath && existsSync(change.newPath)) {
        // newPath 可能是 copyFile 的目标
        await copyFile(change.newPath, change.path);
      } else {
        throw new Error(`无法恢复修改文件: ${change.path}（无备份）`);
      }
      break;
    }

    case 'renamed': {
      // 撤消时移回了 oldPath → 重做：移回 newPath
      if (change.oldPath && change.newPath && existsSync(change.oldPath)) {
        // 如果 newPath 已存在，先备份再 rename
        if (existsSync(change.newPath)) {
          await unlink(change.newPath);
        }
        await rename(change.oldPath, change.newPath);
      } else {
        throw new Error(
          `无法重命名文件: ${change.oldPath} → ${change.newPath}`
        );
      }
      break;
    }

    case 'moved': {
      // 撤消时移回了 oldPath → 重做：移回 newPath
      if (change.oldPath && change.newPath && existsSync(change.oldPath)) {
        // 如果 newPath 已存在，先删除再 move
        if (existsSync(change.newPath)) {
          await unlink(change.newPath);
        }
        await copyFile(change.oldPath, change.newPath);
      } else {
        throw new Error(`无法移动文件: ${change.oldPath} → ${change.newPath}`);
      }
      break;
    }
  }
}

/**
 * 检查指定轮次是否可以重做
 *
 * 条件：
 *   1. 快照存在且 storeAfterVersion = true
 *   2. 快照不是 rolled_back 状态
 *   3. 有关键文件（afterBackupPath 或 backupPath）存在
 *
 * @param sessionId 会话 ID
 * @param roundId 轮次编号
 * @returns 是否可以重做
 */
export async function canRedo(
  sessionId: string,
  roundId: number
): Promise<boolean> {
  const snapshot = await loadSnapshot(sessionId, roundId);
  if (!snapshot) return false;

  if (!snapshot.storeAfterVersion) return false;
  if (snapshot.status === 'rolled_back') return false;

  // 检查是否有可用的备份文件
  for (const change of snapshot.changedFiles) {
    if (change.afterBackupPath && existsSync(change.afterBackupPath))
      return true;
    if (change.type === 'deleted' && existsSync(change.path)) return true;
    if (
      change.type === 'renamed' &&
      change.oldPath &&
      existsSync(change.oldPath)
    )
      return true;
  }

  return false;
}
