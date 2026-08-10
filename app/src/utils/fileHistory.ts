/**
 * 文件历史追踪
 *
 * 追踪文件变更历史，创建快照和备份。
 * 用于回滚和差异比较。不依赖第三方 diff 库。
 */
import { stat, readFile, mkdir, copyFile, unlink } from 'fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, relative, isAbsolute, resolve } from 'path';
import { createHash, randomUUID } from 'crypto';
import { resolvePyappHome } from '@modules/core';

import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('utils:fileHistory');

/**
 * 文件历史备份信息
 */
export interface FileHistoryBackup {
  backupFileName: string | null;
  version: number;
  backupTime: Date;
}

/**
 * 文件历史快照
 */
export interface FileHistorySnapshot {
  messageId: string;
  trackedFileBackups: Record<string, FileHistoryBackup>;
  timestamp: Date;
}

/**
 * 文件历史状态
 */
export interface FileHistoryState {
  snapshots: FileHistorySnapshot[];
  trackedFiles: string[];
  snapshotSequence: number;
}

/**
 * 差异统计
 */
export interface DiffStats {
  filesChanged?: string[];
  insertions: number;
  deletions: number;
}

const MAX_SNAPSHOTS = 100;
const BACKUP_DIR = join(resolvePyappHome(), 'file_history');

/**
 * 确保备份目录存在
 */
function ensureBackupDir(): void {
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

/**
 * 生成文件内容的哈希
 */
function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * 从文件路径生成跟踪键
 */
function trackingKey(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * 创建文件备份
 *
 * 读取文件当前内容并保存到备份目录。
 * 新文件（首次创建）返回 backupFileName = null。
 *
 * @param filePath - 文件路径
 * @param version - 版本号
 * @returns 备份信息
 */
async function createBackup(
  filePath: string,
  version: number
): Promise<FileHistoryBackup> {
  ensureBackupDir();

  const contentHash = hashContent(filePath);

  try {
    const content = await readFile(filePath, 'utf-8');
    const backupName = `${contentHash}@v${version}.bak`;
    const backupPath = join(BACKUP_DIR, backupName);
    await copyFile(filePath, backupPath);

    return {
      backupFileName: backupName,
      version,
      backupTime: new Date(),
    };
  } catch {
    // 文件不存在（新文件）
    return {
      backupFileName: null,
      version,
      backupTime: new Date(),
    };
  }
}

/**
 * 追踪文件编辑
 *
 * 在编辑前创建文件内容备份，以便后续回滚。
 *
 * @param updateState - 更新文件历史状态的函数
 * @param filePath - 要追踪的文件路径
 * @param messageId - 关联的消息 ID
 */
export async function fileHistoryTrackEdit(
  updateState: (updater: (prev: FileHistoryState) => FileHistoryState) => void,
  filePath: string,
  messageId: string
): Promise<void> {
  const trackPath = trackingKey(filePath);

  // 检查最新快照中是否已追踪此文件
  let captured: FileHistoryState | undefined;
  updateState((state) => {
    captured = state;
    return state;
  });

  if (!captured) return;

  const mostRecent = captured.snapshots.at(-1);
  if (mostRecent?.trackedFileBackups[trackPath]) return;

  // 创建备份
  let backup: FileHistoryBackup;
  try {
    backup = await createBackup(filePath, 1);
  } catch {
    return;
  }

  // 更新状态
  updateState((state: FileHistoryState) => {
    const mostRecentSnapshot = state.snapshots.at(-1);
    if (
      !mostRecentSnapshot ||
      mostRecentSnapshot.trackedFileBackups[trackPath]
    ) {
      return state;
    }

    const updatedTrackedFiles = state.trackedFiles.includes(trackPath)
      ? state.trackedFiles
      : [...state.trackedFiles, trackPath];

    const updatedSnapshot = {
      ...mostRecentSnapshot,
      trackedFileBackups: {
        ...mostRecentSnapshot.trackedFileBackups,
        [trackPath]: backup,
      },
    };

    const updatedSnapshots = state.snapshots.slice();
    updatedSnapshots[updatedSnapshots.length - 1] = updatedSnapshot;

    return {
      ...state,
      snapshots: updatedSnapshots,
      trackedFiles: updatedTrackedFiles,
    };
  });
}

/**
 * 创建文件历史快照
 *
 * 追踪当前所有已记录文件的变更，创建新快照。
 * 超过 MAX_SNAPSHOTS 时丢弃最旧的快照。
 *
 * @param updateState - 更新状态的函数
 * @param messageId - 关联的消息 ID
 * @param trackedFiles - 当前追踪的文件列表
 */
export async function fileHistoryMakeSnapshot(
  updateState: (updater: (prev: FileHistoryState) => FileHistoryState) => void,
  messageId: string,
  trackedFiles: string[]
): Promise<void> {
  const backups: Record<string, FileHistoryBackup> = {};

  for (const filePath of trackedFiles) {
    try {
      backups[filePath] = await createBackup(filePath, 1);
    } catch (err) {
      // 跳过无法备份的文件

      handleError(err, {
        module: 'utils:fileHistory',
        action: 'skipUnbackableFile',
      });
    }
  }

  updateState((state: FileHistoryState) => {
    const snapshot: FileHistorySnapshot = {
      messageId,
      trackedFileBackups: backups,
      timestamp: new Date(),
    };

    const snapshots = [...state.snapshots, snapshot];
    if (snapshots.length > MAX_SNAPSHOTS) {
      const removed = snapshots.shift();
      if (removed) {
        // 清理被移除快照的备份文件
        for (const backup of Object.values(removed.trackedFileBackups)) {
          if (backup.backupFileName) {
            const backupPath = join(BACKUP_DIR, backup.backupFileName);
            // @ignore-catch — 清理被移除快照的备份文件，best-effort非关键
            unlink(backupPath).catch(() => {});
          }
        }
      }
    }

    return {
      snapshots,
      trackedFiles: state.trackedFiles,
      snapshotSequence: state.snapshotSequence + 1,
    };
  });
}

/**
 * 恢复文件到历史版本
 *
 * 从备份还原指定文件到指定版本。
 *
 * @param filePath - 文件路径
 * @param backup - 备份信息
 * @returns 是否恢复成功
 */
export async function restoreFileFromHistory(
  filePath: string,
  backup: FileHistoryBackup
): Promise<boolean> {
  if (!backup.backupFileName) {
    // 新文件，删除当前版本
    try {
      await unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  const backupPath = join(BACKUP_DIR, backup.backupFileName);
  if (!existsSync(backupPath)) return false;

  try {
    await copyFile(backupPath, filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取文件历史快照
 *
 * @param snapshots - 历史状态中的快照数组
 * @returns 过滤掉空快照后的快照列表
 */
export function getFileHistorySnapshots(
  snapshots: FileHistorySnapshot[]
): FileHistorySnapshot[] {
  return snapshots.filter((s) => Object.keys(s.trackedFileBackups).length > 0);
}
