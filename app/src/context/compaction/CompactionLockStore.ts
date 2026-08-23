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
 * CompactionLockStore — 压缩锁持久化（P2-5 对标 deepseek-harness compaction/start→end 事件锁）
 *
 * 两层锁：
 * 1. 内存 Set：同进程内双管线并发压缩守卫（跨崩溃不持久）
 * 2. 磁盘 .lock 文件：锁的持久化记录（sessionId + compactionId + startedAt）。
 *    进程崩溃后残留锁在下次 acquire 时检测并清除（孤儿锁检测，
 *    对齐 deepseek-harness 的 unmatched compaction/start）。
 *
 * 锁文件：<dataDir>/compaction-locks/<sanitizedSessionId>.lock
 */

import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { resolveDataDir } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('context:compaction:lock');

/** 锁 TTL：Tier3 压缩最长 60s 超时，120s 覆盖正常压缩时长 + 缓冲 */
const LOCK_TTL_MS = 120_000;

interface CompactionLockRecord {
  compactionId: string;
  startedAt: number;
}

export class CompactionLockStore {
  private readonly locksDir: string;
  /** 同进程并发守卫（内存 Set，不持久化） */
  private readonly activeSessions = new Set<string>();

  constructor(dataDir: string = resolveDataDir()) {
    this.locksDir = join(dataDir, 'compaction-locks');
  }

  private lockPath(sessionId: string): string {
    // sessionId 防御性清洗：只保留字母数字 _ -，防止路径穿越
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.locksDir, `${safe}.lock`);
  }

  /**
   * 尝试获取压缩锁。
   * @param sessionId 会话 ID
   * @returns 成功时返回 compactionId（release 时校验用），已有活跃锁时返回 null
   */
  tryAcquire(sessionId: string): string | null {
    if (this.activeSessions.has(sessionId)) {
      logger.debug('compaction:lock_in_memory — 同进程压缩已在执行', {
        sessionId,
      });
      return null;
    }
    const lockPath = this.lockPath(sessionId);
    let orphanCleared = false;
    try {
      if (existsSync(lockPath)) {
        const stale = Date.now() - statSync(lockPath).mtimeMs > LOCK_TTL_MS;
        if (!stale) {
          // 单进程内不会出现（内存 Set 已拦截）；多进程/异常路径防御
          logger.warn(
            'compaction:lock_active_on_disk — 磁盘锁仍新鲜，拒绝并发压缩',
            { sessionId, lockPath }
          );
          return null;
        }
        // 崩溃残留（孤儿锁）：mtime 超过 TTL → 判定为上次崩溃遗留，清除后重取
        logger.warn(
          'compaction:lock_orphan_detected — 检测到崩溃残留锁，已清除',
          {
            sessionId,
            lockPath,
          }
        );
        unlinkSync(lockPath);
        orphanCleared = true;
      }
      const compactionId = randomUUID();
      const startedAt = Date.now();
      mkdirSync(this.locksDir, { recursive: true });
      const record: CompactionLockRecord = { compactionId, startedAt };
      writeFileSync(lockPath, JSON.stringify(record), 'utf-8');
      this.activeSessions.add(sessionId);
      logger.info('compaction:lock_acquired — 压缩锁获取成功', {
        sessionId,
        compactionId,
        lockPath,
        source: orphanCleared ? 'orphan_cleared' : 'fresh',
        startedAt,
        ttlMs: LOCK_TTL_MS,
      });
      return compactionId;
    } catch (err) {
      // 锁文件 IO 失败不阻断压缩主流程——降级为纯内存锁（与旧行为一致）
      logger.warn('compaction:lock_io_failed — 锁文件写入失败，降级为内存锁', {
        sessionId,
        lockPath,
        error: String(err),
      });
      this.activeSessions.add(sessionId);
      const fallbackId = randomUUID();
      logger.info('compaction:lock_fallback_memory — 降级内存锁已生效', {
        sessionId,
        compactionId: fallbackId,
      });
      return fallbackId;
    }
  }

  /**
   * 释放压缩锁。
   * compactionId 与磁盘记录不匹配（锁已被其他压缩覆盖）时跳过磁盘删除，保护新锁。
   */
  release(sessionId: string, compactionId: string): void {
    this.activeSessions.delete(sessionId);
    const lockPath = this.lockPath(sessionId);
    try {
      if (!existsSync(lockPath)) {
        logger.debug('compaction:lock_released — 锁释放（磁盘锁已不存在）', {
          sessionId,
          compactionId,
          diskRemoved: false,
          reason: 'missing',
        });
        return;
      }
      const record = JSON.parse(
        readFileSync(lockPath, 'utf-8')
      ) as CompactionLockRecord;
      if (record.compactionId === compactionId) {
        unlinkSync(lockPath);
        logger.debug('compaction:lock_released — 锁释放（磁盘锁已删除）', {
          sessionId,
          compactionId,
          diskRemoved: true,
          reason: 'matched',
        });
      } else {
        logger.warn(
          'compaction:lock_released — 锁释放（磁盘锁已被其他压缩覆盖，跳过删除）',
          {
            sessionId,
            compactionId,
            diskCompactionId: record.compactionId,
            diskRemoved: false,
            reason: 'mismatch',
          }
        );
      }
    } catch (err) {
      // @ignore-catch 读/删锁文件失败不影响压缩主流程（残留由下次 acquire 清除）
      logger.warn(
        'compaction:lock_release_failed — 锁释放异常（残留由下次 acquire 清除）',
        {
          sessionId,
          compactionId,
          error: String(err),
        }
      );
    }
  }
}

/** 默认单例 */
export const compactionLockStore = new CompactionLockStore();
