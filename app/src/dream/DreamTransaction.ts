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
 * DreamTransaction — 梦境 Write 阶段事务化
 *
 * 对齐论文 Algorithm 10（备份 → 写入 → 失败回滚）。
 * 备份落盘至 data/transactions/，apply/rollback 统一原子写（临时文件 + rename），
 * 禁止直接 writeFile 覆盖。
 *
 * 存量复用（CS01）：
 * - 原子写：session/persistence/AtomicWriter.ts（tmp+rename）
 * - 写前备份登记：security/rollback/FileOperationTracker.beforeToolOperation 模式
 * - 快照落盘：security/rollback/SnapshotStorage 模式（简化为 data/transactions/）
 */

import { readFile, mkdir, rm, unlink } from 'fs/promises';
import { join } from 'path';
import crypto from 'crypto';
import { AtomicWriter } from '@modules/session/persistence/AtomicWriter';
import { resolveDataSubDir } from '@modules/core';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { handleError } from '@modules/error/handleError';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('dream:transaction');

export interface TxOperation {
  kind: 'file' | 'db';
  /** 目标标识（文件路径 / 记录 id），同 key 去重备份 */
  key: string;
  /** 写入操作（需原子写） */
  apply: () => Promise<void>;
  /** 写前快照（落盘到 txDir） */
  backup: (txDir: string) => Promise<void>;
  /** 恢复快照（原子替换） */
  rollback: (txDir: string) => Promise<void>;
}

/** 备份元数据（记录原文件是否存在） */
interface BackupMeta {
  existed: boolean;
}

const atomicWriter = new AtomicWriter();

/**
 * 文件类默认辅助：自动备份 → 原子写 → 失败恢复。
 * 普通文件场景禁止手写 backup/rollback 三方法。
 * @param targetPath 目标文件路径
 * @param write 写入回调（内部必须原子写目标文件，推荐 AtomicWriter）
 */
export function fileTx(
  targetPath: string,
  write: () => Promise<void>
): TxOperation {
  return {
    kind: 'file',
    key: targetPath,
    apply: write,
    backup: async (txDir: string) => {
      const original = await readFile(targetPath).catch(() => null);
      const backupPath = backupFilePath(txDir, targetPath);
      await atomicWriter.write(backupPath, original ?? Buffer.alloc(0));
      const meta: BackupMeta = { existed: original !== null };
      await atomicWriter.writeJSON(backupMetaPath(txDir, targetPath), meta);
    },
    rollback: async (txDir: string) => {
      const metaPath = backupMetaPath(txDir, targetPath);
      const meta: BackupMeta = JSON.parse(await readFile(metaPath, 'utf-8'));
      if (!meta.existed) {
        // 原文件不存在 → 删除（容错：目标可能已被并发删除）
        await unlink(targetPath).catch(() => {});
        return;
      }
      const data = await readFile(backupFilePath(txDir, targetPath));
      await atomicWriter.write(targetPath, data);
    },
  };
}

/**
 * 事务执行器
 * ① 按 key 去重全量备份（落盘 data/transactions/）→ ② 逐项 apply
 * ③ 任一项失败 → 全量 rollback（原子替换）→ ④ throw
 * ⑤ 全部成功 → commit 删除备份快照
 */
export class DreamTransaction {
  static async run(ops: TxOperation[]): Promise<void> {
    // ① 按 key 去重（同一 key 只备份/恢复一次）
    const seen = new Set<string>();
    const deduped = ops.filter((op) => {
      if (seen.has(op.key)) return false;
      seen.add(op.key);
      return true;
    });

    if (deduped.length === 0) return;

    // 创建事务目录（崩溃一致性：备份落盘，非仅内存）
    const txId = `tx_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const txDir = join(resolveDataSubDir('transactions'), txId);
    await mkdir(txDir, { recursive: true });

    const applied: TxOperation[] = [];
    let backupDone = false;
    try {
      // ② 全量备份
      for (const op of deduped) {
        await op.backup(txDir);
      }
      backupDone = true;

      // ③ 逐项 apply（先登记再执行：apply 抛错时该 op 也参与回滚）
      for (const op of deduped) {
        applied.push(op);
        await op.apply();
      }
    } catch (error) {
      // ④ 全量 rollback（逆序）
      const rollbackErrors: unknown[] = [];
      for (const op of [...applied].reverse()) {
        try {
          await op.rollback(txDir);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
          logger.error('事务回滚失败（备份快照保留供人工恢复）', {
            key: op.key,
            error: String(rollbackError),
          });
          await handleError(rollbackError, {
            module: 'dream:transaction',
            action: 'rollback',
            context: { key: op.key, txId },
          });
        }
      }

      // 回滚全部成功才清理快照；有失败则保留供人工恢复
      if (rollbackErrors.length === 0) {
        await rm(txDir, { recursive: true, force: true }).catch(() => {});
      } else {
        logger.error('事务回滚存在失败，备份快照保留', { txDir });
      }

      const cause = error instanceof Error ? error : new Error(String(error));
      throw new AppError(
        `梦境事务执行失败：${cause.message}`,
        ErrorCategory.DATA,
        ErrorSeverity.HIGH,
        'DREAM_TX_FAILED',
        {
          txId,
          backupDir: txDir,
          backupCompleted: backupDone,
          rollbackFailedCount: rollbackErrors.length,
          backupRetained: rollbackErrors.length > 0,
        }
      );
    }

    // ⑤ commit：删除备份快照
    await rm(txDir, { recursive: true, force: true }).catch(() => {});
    logger.debug('梦境事务提交成功', { txId, opCount: deduped.length });
  }
}

/** 备份文件路径（key 哈希化，避免非法文件名） */
function backupFilePath(txDir: string, key: string): string {
  return join(txDir, `${hashKey(key)}.bak`);
}

/** 备份元数据路径 */
function backupMetaPath(txDir: string, key: string): string {
  return join(txDir, `${hashKey(key)}.meta.json`);
}

/** 简单哈希（sha1 截断） */
function hashKey(key: string): string {
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
}
