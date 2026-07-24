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
 * DreamCheckpoint — 梦境检查点恢复机制
 *
 * 在应用启动时扫描残留的检查点文件，
 * 恢复未完成的梦境周期（标记为 failed）或清理已完成的检查点。
 */

import { resolveDataSubDir } from '@modules/core';
import { join } from 'path';
import { readdir, readFile, unlink } from 'fs/promises';
import { Logger, LogLevel } from '@modules/monitoring';
import type { DreamCycleRecord } from './types';

const logger = new Logger({
  module: 'dream:checkpoint',
  level: LogLevel.INFO,
});

interface CheckpointData {
  cycleId: string;
  phase: 'gathered' | 'analyzed' | 'generated' | 'written_all';
  timestamp: number;
  snapshotTime: number;
}

/**
 * 启动时恢复检查点
 * 返回恢复统计信息
 */
export async function recoverCheckpoints(): Promise<{
  recovered: number;
  cleaned: number;
}> {
  const checkpointsDir = join(resolveDataSubDir('dream'), 'checkpoints');
  let files: string[];

  try {
    files = await readdir(checkpointsDir);
  } catch {
    // 目录不存在，无需恢复
    return { recovered: 0, cleaned: 0 };
  }

  const checkpointFiles = files.filter(
    (f) => f.startsWith('checkpoint_') && f.endsWith('.json')
  );
  if (checkpointFiles.length === 0) {
    return { recovered: 0, cleaned: 0 };
  }

  let recovered = 0;
  let cleaned = 0;

  // 动态导入 DreamPersistence（避免循环依赖）
  const { DreamPersistence } = await import('./DreamPersistence');
  const persistence = new DreamPersistence();

  // 读取 cycles 目录中已有的记录 ID，用于判断 written_all 是否完整
  const cyclesDir = join(resolveDataSubDir('dream'), 'cycles');
  let existingCycleIds: Set<string>;
  try {
    const cycleFiles = await readdir(cyclesDir);
    existingCycleIds = new Set(
      cycleFiles
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace('.json', ''))
    );
  } catch {
    existingCycleIds = new Set();
  }

  for (const file of checkpointFiles) {
    const checkpointPath = join(checkpointsDir, file);
    try {
      const data = await readFile(checkpointPath, 'utf-8');
      const checkpoint: CheckpointData = JSON.parse(data);

      if (checkpoint.phase === 'written_all') {
        // 检查 DreamCycleRecord 是否已写入
        if (existingCycleIds.has(checkpoint.cycleId)) {
          // 正常完成，清理检查点
          await unlink(checkpointPath);
          cleaned++;
          logger.info(
            `[DreamCheckpoint] 已完成周期 ${checkpoint.cycleId} 的检查点已清理`
          );
        } else {
          // 检查点声称完成但记录缺失 → 异常，标记为 failed
          await markCycleFailed(persistence, checkpoint.cycleId, checkpoint);
          await unlink(checkpointPath);
          recovered++;
          logger.warn(
            `[DreamCheckpoint] 周期 ${checkpoint.cycleId} 检查点为 written_all 但记录缺失，已标记为 failed`
          );
        }
      } else {
        // 未完成的检查点 (gathered/analyzed/generated)
        await markCycleFailed(persistence, checkpoint.cycleId, checkpoint);
        await unlink(checkpointPath);
        recovered++;
        logger.warn(
          `[DreamCheckpoint] 未完成周期 ${checkpoint.cycleId} (phase=${checkpoint.phase}) 已标记为 failed`
        );
      }
    } catch (e) {
      // 损坏的检查点文件直接删除
      try {
        await unlink(checkpointPath);
        cleaned++;
      } catch {
        /* ignore */
      }
      logger.warn(`[DreamCheckpoint] 损坏的检查点文件已删除: ${file}`, {
        error: String(e),
      });
    }
  }

  if (recovered > 0 || cleaned > 0) {
    logger.info(
      `[DreamCheckpoint] 恢复完成: ${recovered} 个周期标记为 failed, ${cleaned} 个检查点已清理`
    );
  }

  return { recovered, cleaned };
}

/**
 * 标记未完成的周期为 failed
 */
async function markCycleFailed(
  persistence: { saveCycle: (record: DreamCycleRecord) => Promise<void> },
  cycleId: string,
  checkpoint: CheckpointData
): Promise<void> {
  const failedRecord: DreamCycleRecord = {
    cycleId,
    startedAt: checkpoint.timestamp,
    completedAt: Date.now(),
    triggerSource: 'manual',
    status: 'failed',
    snapshotTime: checkpoint.snapshotTime,
    sessionsScanned: 0,
    sessionsProcessed: 0,
    knowledgeFilesProcessed: 0,
    memoriesCreated: 0,
    memoriesRefined: 0,
    knowledgeFilesUpdated: 0,
    soulUpdated: false,
    userProfileUpdated: false,
    processedSessionIds: [],
    processedKnowledgeFiles: [],
    memoryCount: 0,
    insights: [],
    errors: [`周期中断于阶段: ${checkpoint.phase}，由启动恢复标记为 failed`],
    soulConflicts: 0,
    userConflicts: 0,
  };

  await persistence.saveCycle(failedRecord);
}
