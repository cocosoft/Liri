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
 * 清理管理器
 *
 * 负责两个关键清理任务：
 *   1. 中断轮次的临时文件清理（cleanupInterruptedRounds）
 *   2. 快照配额管理（超配额时清理最旧快照）
 *
 * 对应方案文档 §3.5（中断轮次清理）和 §9（生命周期管理）
 */

import { readdir, unlink, stat, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { getLogger } from '@modules/monitoring';
import {
  getSnapshotsRoot,
  getManifestPath,
  listSessionSnapshots,
  deleteRoundSnapshot,
  getTotalSnapshotSize,
} from './SnapshotStorage';
import type { RoundSnapshot } from './types';

const logger = getLogger('CleanupManager');

/** 默认快照配额上限（5GB） */
const DEFAULT_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;

/**
 * 获取临时文件根目录
 */
function getTempRoot(): string {
  try {
    const { resolveSnapshotsDir } = require('@modules/core/paths');
    return require('path').join(resolveSnapshotsDir(), 'tmp');
  } catch {
    return join(homedir(), '.pyapp', 'tmp', 'snapshots');
  }
}

/**
 * 清理中断轮次的临时文件残留
 *
 * 中断场景：
 *   - 用户在 AI 执行到一半时关闭应用
 *   - 工具调用链在中途抛出未捕获异常
 *   - 网络中断导致会话超时
 *
 * 中断轮次的特征：临时目录中存在 roundDir，但对应的 manifest 文件不存在。
 * 这些临时文件永远不会被 finalizeRound 处理，需要独立清理。
 *
 * 对应方案文档 §3.5 的 cleanupInterruptedRounds 设计
 */
export async function cleanupInterruptedRounds(): Promise<void> {
  const tempRoot = getTempRoot();
  if (!existsSync(tempRoot)) return;

  try {
    const sessions = await readdir(tempRoot);
    for (const sessionId of sessions) {
      const sessionTempPath = join(tempRoot, sessionId);

      try {
        const rounds = await readdir(sessionTempPath);
        for (const roundDir of rounds) {
          const roundId = parseInt(roundDir, 10);
          if (isNaN(roundId)) continue;

          // 检查对应的 manifest 是否存在（在正式存储目录中）
          const manifestPath = getManifestPath(sessionId, roundId);
          if (!existsSync(manifestPath)) {
            // 快照不存在 → 轮次未完成 → 清理临时文件
            const roundTempPath = join(sessionTempPath, roundDir);
            await rm(roundTempPath, { recursive: true, force: true });
            logger.warn('清理中断轮次临时文件', { sessionId, roundDir });
          }
        }

        // 清理空会话目录
        const remaining = await readdir(sessionTempPath);
        if (remaining.length === 0) {
          await rm(sessionTempPath, { recursive: true, force: true });
        }
      } catch (err) {
        // 跳过无法读取的会话目录
      }
    }
  } catch (error) {
    logger.warn('清理中断轮次失败', { error: String(error) });
  }
}

/**
 * 清理指定轮次的临时文件残留
 * 在 finalizeRound 开始时调用，确保旧临时文件被清除
 */
export async function cleanupRoundTempFiles(
  roundId: number,
  sessionId: string
): Promise<void> {
  const roundTempPath = join(getTempRoot(), sessionId, String(roundId));
  if (existsSync(roundTempPath)) {
    await rm(roundTempPath, { recursive: true, force: true });
    logger.debug('清理本轮旧临时文件', { sessionId, roundId });
  }
}

/**
 * 检查快照配额并在超限时清理最旧快照
 *
 * 清理策略：
 *   - 按创建时间升序排列（最早的先清理）
 *   - 一直清理到总大小低于配额的 80%
 *   - 在只有 1 个会话、1 轮快照时不误删非 oldest 快照
 *
 * 对应方案文档 §9 的生命周期管理
 */
export async function enforceSnapshotQuota(
  maxBytes: number = DEFAULT_QUOTA_BYTES
): Promise<{ cleaned: number; freedBytes: number }> {
  let totalSize = await getTotalSnapshotSize();

  if (totalSize <= maxBytes) {
    return { cleaned: 0, freedBytes: 0 };
  }

  logger.warn('快照配额超限，开始清理', { totalSize, maxBytes });
  let cleaned = 0;
  let freedBytes = 0;

  // 收集所有快照（跨会话）
  const allSnapshots: RoundSnapshot[] = [];
  const snapshotsRoot = getSnapshotsRoot();

  if (!existsSync(snapshotsRoot)) {
    return { cleaned: 0, freedBytes: 0 };
  }

  try {
    const sessions = await readdir(snapshotsRoot);
    for (const sessionId of sessions) {
      const sessionSnapshots = await listSessionSnapshots(sessionId);
      allSnapshots.push(...sessionSnapshots);
    }
  } catch (error) {
    logger.warn('收集快照列表失败', { error: String(error) });
    return { cleaned: 0, freedBytes: 0 };
  }

  // 按创建时间升序排列（最早的在前）
  allSnapshots.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const targetSize = maxBytes * 0.8; // 目标：清理到配额的 80%
  const sessionRoundCount = new Map<string, number>();
  for (const snap of allSnapshots) {
    const key = `${snap.sessionId}`;
    sessionRoundCount.set(key, (sessionRoundCount.get(key) || 0) + 1);
  }

  for (const snapshot of allSnapshots) {
    if (totalSize <= targetSize) break;

    // 🟢 Liri v6: R5 边界保护——在只有 1 个会话、1 轮快照时不误删
    const key = `${snapshot.sessionId}`;
    const count = sessionRoundCount.get(key) || 0;
    if (count <= 1 && allSnapshots.length <= 1) {
      logger.warn('配额超限但只有 1 轮快照，跳过清理', {
        sessionId: snapshot.sessionId,
        roundId: snapshot.roundId,
      });
      break;
    }

    await deleteRoundSnapshot(snapshot.sessionId, snapshot.roundId);
    totalSize -= snapshot.totalSize;
    freedBytes += snapshot.totalSize;
    cleaned++;

    // 更新会话轮次计数
    sessionRoundCount.set(key, count - 1);
  }

  logger.info('清理完成', { cleaned, freedBytes, remainingSize: totalSize });
  return { cleaned, freedBytes };
}

/**
 * 应用启动时的清理钩子
 * 在应用启动时调用，确保临时文件被清理
 */
export async function onApplicationStart(): Promise<void> {
  await cleanupInterruptedRounds();
  await enforceSnapshotQuota();
  logger.info('启动清理完成');
}
