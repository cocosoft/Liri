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
 * 快照存储层
 *
 * 负责快照的持久化存储、加载和管理。
 * 实现方案文档 §3.3 的存储结构设计：
 *   - ~/.pyapp/data/snapshots/{sessionId}/{roundId}/manifest.json
 *   - ~/.pyapp/data/snapshots/{sessionId}/{roundId}/backups/{encodedPath}
 *
 * 特性：
 *   - 元数据校验（校验和 + 原子写入 + 旧版本备份）
 *   - 哈希映射存储路径（encodeFilePath）
 *   - 并发控制（索引文件级锁）
 */

import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  unlink,
  stat,
  copyFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { Logger, LogLevel } from '@modules/monitoring';
import { xxHash, encodeFilePath } from './xxHash';
import type { RoundSnapshot, FileChange, SessionIndexEntry } from './types';

const logger = new Logger({ module: 'SnapshotStorage' });

/** 数据模型版本号 */
const SCHEMA_VERSION = 1;

/**
 * 获取存储根目录
 */
function getSnapshotsRoot(): string {
  return join(homedir(), '.pyapp', 'data', 'snapshots');
}

/**
 * 获取指定会话的快照目录
 */
function getSessionDir(sessionId: string): string {
  return join(getSnapshotsRoot(), sessionId);
}

/**
 * 获取指定轮次的快照目录
 */
function getRoundDir(sessionId: string, roundId: number): string {
  return join(getSessionDir(sessionId), String(roundId));
}

/**
 * 获取指定轮次的快照清单文件路径
 */
function getManifestPath(sessionId: string, roundId: number): string {
  return join(getRoundDir(sessionId, roundId), 'manifest.json');
}

/**
 * 获取备份目录
 */
function getBackupsDir(sessionId: string, roundId: number): string {
  return join(getRoundDir(sessionId, roundId), 'backups');
}

/**
 * 获取会话索引文件路径
 */
function getSessionIndexPath(): string {
  return join(getSnapshotsRoot(), 'sessions-index.json');
}

/**
 * 获取锁文件路径
 */
function getLockPath(): string {
  return join(getSnapshotsRoot(), 'index-lock.lock');
}

/**
 * 确保快照目录存在
 */
async function ensureSnapshotDirs(
  sessionId: string,
  roundId: number
): Promise<void> {
  const backupsDir = getBackupsDir(sessionId, roundId);
  await mkdir(backupsDir, { recursive: true });
}

/**
 * 保存快照清单
 * 实现原子写入：先写入 .tmp 文件，再 rename
 */
async function saveManifest(manifest: RoundSnapshot): Promise<void> {
  const manifestPath = getManifestPath(manifest.sessionId, manifest.roundId);
  const tmpPath = manifestPath + '.tmp';

  // 计算校验和
  const content = JSON.stringify(manifest, null, 2);
  const checksum = createHash('sha256').update(content).digest('hex');
  manifest.checksum = checksum;

  // 原子写入
  await writeFile(tmpPath, JSON.stringify(manifest, null, 2), 'utf-8');
  await copyFile(tmpPath, manifestPath);
  await unlink(tmpPath);
}

/**
 * 加载快照清单
 * 校验完整性：验证 checksum 是否匹配
 */
async function loadManifest(
  sessionId: string,
  roundId: number
): Promise<RoundSnapshot | null> {
  const manifestPath = getManifestPath(sessionId, roundId);

  try {
    const content = await readFile(manifestPath, 'utf-8');
    const manifest: RoundSnapshot = JSON.parse(content);

    // 校验 checksum
    if (manifest.checksum) {
      const expectedChecksum = manifest.checksum;
      const manifestWithoutChecksum = { ...manifest };
      delete (manifestWithoutChecksum as any).checksum;
      const actualChecksum = createHash('sha256')
        .update(JSON.stringify(manifestWithoutChecksum, null, 2))
        .digest('hex');

      if (actualChecksum !== expectedChecksum) {
        logger.error('快照校验和不匹配，数据可能已损坏', {
          sessionId,
          roundId,
          expectedChecksum,
          actualChecksum,
        });
        return null;
      }
    }

    // schemaVersion 迁移
    if (!manifest.schemaVersion) {
      manifest.schemaVersion = 0;
    }

    return manifest;
  } catch (error) {
    logger.warn('加载快照失败', { sessionId, roundId, error: String(error) });
    return null;
  }
}

/**
 * 保存文件备份
 */
async function saveFileBackup(
  sessionId: string,
  roundId: number,
  filePath: string,
  content: Buffer
): Promise<string> {
  const backupsDir = getBackupsDir(sessionId, roundId);
  const encodedName = encodeFilePath(filePath, 'backup');
  const backupPath = join(backupsDir, encodedName);

  await writeFile(backupPath, content);
  return backupPath;
}

/**
 * 加载文件备份内容
 */
async function loadFileBackup(backupPath: string): Promise<Buffer | null> {
  try {
    return await readFile(backupPath);
  } catch {
    return null;
  }
}

/**
 * 创建轮次快照
 * 对应方案文档 §3.5 的 finalizeRound 功能
 */
export async function createRoundSnapshot(
  sessionId: string,
  roundId: number,
  userMessageSummary: string,
  changedFiles: FileChange[],
  scanStatus: 'complete' | 'partial',
  storeAfterVersion: boolean = false
): Promise<RoundSnapshot> {
  await ensureSnapshotDirs(sessionId, roundId);

  const manifest: RoundSnapshot = {
    roundId,
    sessionId,
    userMessageSummary: userMessageSummary.slice(0, 100),
    createdAt: new Date().toISOString(),
    changedFiles,
    totalSize: 0,
    schemaVersion: SCHEMA_VERSION,
    storeAfterVersion,
    scanStatus,
    status: 'active',
  };

  // 计算总大小（备份文件大小之和）
  let totalSize = 0;
  for (const change of changedFiles) {
    if (change.backupPath) {
      try {
        const fileStat = await stat(change.backupPath);
        totalSize += fileStat.size;
      } catch {
        // 备份文件可能不存在
      }
    }
    if (change.afterBackupPath) {
      try {
        const fileStat = await stat(change.afterBackupPath);
        totalSize += fileStat.size;
      } catch {
        // 后备份文件可能不存在
      }
    }
  }
  manifest.totalSize = totalSize;

  await saveManifest(manifest);
  logger.info('快照已创建', {
    sessionId,
    roundId,
    changedFiles: changedFiles.length,
    totalSize,
  });

  return manifest;
}

/**
 * 加载轮次快照
 */
export async function loadSnapshot(
  sessionId: string,
  roundId: number
): Promise<RoundSnapshot | null> {
  return loadManifest(sessionId, roundId);
}

/**
 * 删除轮次快照
 */
export async function deleteRoundSnapshot(
  sessionId: string,
  roundId: number
): Promise<void> {
  const roundDir = getRoundDir(sessionId, roundId);

  try {
    await unlink(getManifestPath(sessionId, roundId));
    // 递归删除备份目录及其内容
    const backupsDir = getBackupsDir(sessionId, roundId);
    if (existsSync(backupsDir)) {
      const files = await readdir(backupsDir);
      for (const file of files) {
        await unlink(join(backupsDir, file));
      }
      // 清理空目录（roundDir 在 unlink manifest 后可能为空）
      try {
        await unlink(backupsDir);
        const parentFiles = await readdir(dirname(roundDir));
        if (parentFiles.length === 0) {
          await unlink(dirname(roundDir));
        }
      } catch {
        // 目录非空或不存在，忽略
      }
    }
    logger.info('快照已删除', { sessionId, roundId });
  } catch (error) {
    logger.warn('删除快照失败', { sessionId, roundId, error: String(error) });
  }
}

/**
 * 获取指定会话的所有快照轮次列表（按轮次降序）
 */
export async function listSessionSnapshots(
  sessionId: string
): Promise<RoundSnapshot[]> {
  const sessionDir = getSessionDir(sessionId);

  try {
    const entries = await readdir(sessionDir);
    const snapshots: RoundSnapshot[] = [];

    for (const entry of entries) {
      const roundId = parseInt(entry, 10);
      if (isNaN(roundId)) continue;

      const manifest = await loadManifest(sessionId, roundId);
      if (manifest) {
        snapshots.push(manifest);
      }
    }

    // 按轮次降序排列（最新的在前）
    snapshots.sort((a, b) => b.roundId - a.roundId);
    return snapshots;
  } catch {
    return [];
  }
}

/**
 * 更新会话索引
 */
export async function updateSessionIndex(
  sessionId: string,
  entry: SessionIndexEntry
): Promise<void> {
  const indexPath = getSessionIndexPath();

  // 确保索引目录存在
  await mkdir(dirname(indexPath), { recursive: true });

  let index: Record<string, SessionIndexEntry> = {};
  try {
    const content = await readFile(indexPath, 'utf-8');
    index = JSON.parse(content);
  } catch {
    // 索引文件还不存在
  }

  index[sessionId] = entry;
  await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

/**
 * 获取快照总用量
 */
export async function getTotalSnapshotSize(): Promise<number> {
  const root = getSnapshotsRoot();

  try {
    const sessions = await readdir(root);
    let totalSize = 0;

    for (const sessionId of sessions) {
      const sessionDir = join(root, sessionId);
      try {
        const rounds = await readdir(sessionDir);
        for (const roundId of rounds) {
          const manifest = await loadManifest(sessionId, parseInt(roundId));
          if (manifest) {
            totalSize += manifest.totalSize;
          }
        }
      } catch {
        // 跳过无法读取的会话目录
      }
    }

    return totalSize;
  } catch {
    return 0;
  }
}

export {
  getSnapshotsRoot,
  getSessionDir,
  getRoundDir,
  getManifestPath,
  getBackupsDir,
  getSessionIndexPath,
  getLockPath,
  ensureSnapshotDirs,
  saveManifest,
  loadManifest,
  saveFileBackup,
  loadFileBackup,
};
