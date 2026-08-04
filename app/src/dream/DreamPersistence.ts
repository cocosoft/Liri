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
 * DreamPersistence — 梦境持久化
 *
 * 记录梦境执行历史，用于判断最短间隔等调度决策。
 */

import { resolveDataSubDir } from '@modules/core';
import { join } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import type { DreamRecord, DreamCycleRecord, DreamCycleSummary } from './types';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({
  module: 'dream:dreamPersistence',
  level: LogLevel.INFO,
});

const DREAM_RECORDS_FILE = 'dream_records.json';
const MAX_RECORDS = 50;
const CYCLES_DIR = 'cycles';
const CYCLES_MAX = 100;
const CYCLES_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

export class DreamPersistence {
  private records: DreamRecord[] = [];
  private storagePath: string;
  private loaded = false;

  constructor() {
    this.storagePath = join(resolveDataSubDir('dream'), DREAM_RECORDS_FILE);
  }

  /** 加载记录 */
  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      await mkdir(join(resolveDataSubDir('dream')), { recursive: true });
      const data = await readFile(this.storagePath, 'utf-8');
      this.records = JSON.parse(data);
      this.loaded = true;
      logger.info(
        `[DreamPersistence] 已加载 ${this.records.length} 条梦境记录`
      );
    } catch (e) {
      // ENOENT: 首次运行无存储文件，正常
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        void handleError(e instanceof Error ? e : new Error(String(e)), {
          module: 'dream:persistence',
          action: 'load',
        });
      }
      this.records = [];
      this.loaded = true;
    }
  }

  /** 保存记录 */
  async save(record: DreamRecord): Promise<void> {
    await this.load();
    this.records.push(record);
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS);
    }
    try {
      await writeFile(
        this.storagePath,
        JSON.stringify(this.records, null, 2),
        'utf-8'
      );
    } catch (e) {
      void handleError(e instanceof Error ? e : new Error(String(e)), {
        module: 'dream:persistence',
        action: 'save',
      });
      logger.error(
        '[DreamPersistence] 保存记录失败',
        e instanceof Error ? e : new Error(String(e))
      );
    }
  }

  /** 获取上次梦境完成时间（毫秒时间戳），若无则返回 0 */
  getLastCompletedAt(): number {
    const completed = this.records
      .filter((r) => r.success)
      .sort((a, b) => b.completedAt - a.completedAt);
    return completed.length > 0 ? completed[0].completedAt : 0;
  }

  /** 获取所有记录 */
  getAllRecords(): DreamRecord[] {
    return [...this.records];
  }

  // ──── 梦境周期记录 (DreamCycleRecord) ────

  /** 获取梦境周期存储路径 */
  private getCyclePath(cycleId: string): string {
    return join(resolveDataSubDir('dream'), CYCLES_DIR, `${cycleId}.json`);
  }

  /** 获取 cycles 目录路径 */
  private getCyclesDir(): string {
    return join(resolveDataSubDir('dream'), CYCLES_DIR);
  }

  /** 保存梦境周期记录 */
  async saveCycle(record: DreamCycleRecord): Promise<void> {
    const cyclesDir = this.getCyclesDir();
    await mkdir(cyclesDir, { recursive: true });
    const filePath = this.getCyclePath(record.cycleId);
    await writeFile(filePath, JSON.stringify(record, null, 2), 'utf-8');
    logger.info(`[DreamPersistence] 梦境周期记录已保存: ${record.cycleId}`);
  }

  /** 读取单个梦境周期记录 */
  async getCycle(cycleId: string): Promise<DreamCycleRecord | null> {
    const filePath = this.getCyclePath(cycleId);
    try {
      const data = await readFile(filePath, 'utf-8');
      return JSON.parse(data) as DreamCycleRecord;
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        void handleError(e instanceof Error ? e : new Error(String(e)), {
          module: 'dream:persistence',
          action: 'getCycle',
        });
      }
      return null;
    }
  }

  /** 列出梦境周期摘要 */
  async listCycles(opts?: {
    page?: number;
    pageSize?: number;
    triggerSource?: string;
    status?: string;
    startTime?: number;
    endTime?: number;
    sortOrder?: 'asc' | 'desc';
  }): Promise<{ cycles: DreamCycleSummary[]; total: number }> {
    const { readdir } = await import('fs/promises');
    const { readFile } = await import('fs/promises');
    const cyclesDir = this.getCyclesDir();

    let files: string[];
    try {
      files = await readdir(cyclesDir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        void handleError(e instanceof Error ? e : new Error(String(e)), {
          module: 'dream:persistence',
          action: 'listCyclesReadDir',
        });
      }
      return { cycles: [], total: 0 };
    }

    const cycleFiles = files.filter((f) => f.endsWith('.json'));
    const cycles: DreamCycleRecord[] = [];

    for (const file of cycleFiles) {
      try {
        const data = await readFile(join(cyclesDir, file), 'utf-8');
        cycles.push(JSON.parse(data) as DreamCycleRecord);
      } catch {
        void handleError(new Error('解析梦境周期文件失败'), {
          module: 'dream:persistence',
          action: 'listCyclesParse',
        });
        // 损坏文件跳过
      }
    }

    // 过滤
    let filtered = cycles;
    if (opts?.triggerSource) {
      filtered = filtered.filter(
        (c) => c.triggerSource === opts!.triggerSource
      );
    }
    if (opts?.status) {
      filtered = filtered.filter((c) => c.status === opts!.status);
    }
    if (opts?.startTime !== undefined) {
      filtered = filtered.filter((c) => c.completedAt >= opts!.startTime!);
    }
    if (opts?.endTime !== undefined) {
      filtered = filtered.filter((c) => c.completedAt <= opts!.endTime!);
    }

    // 排序
    const order = opts?.sortOrder ?? 'desc';
    filtered.sort((a, b) => {
      if (order === 'asc') return a.completedAt - b.completedAt;
      return b.completedAt - a.completedAt;
    });

    const total = filtered.length;
    const page = opts?.page ?? 1;
    const pageSize = Math.min(opts?.pageSize ?? 20, 100);
    const start = (page - 1) * pageSize;
    const paged = filtered.slice(start, start + pageSize);

    const summaries: DreamCycleSummary[] = paged.map((c) => ({
      cycleId: c.cycleId,
      startedAt: c.startedAt,
      completedAt: c.completedAt,
      triggerSource: c.triggerSource,
      status: c.status,
      sessionsScanned: c.sessionsScanned,
      sessionsProcessed: c.sessionsProcessed,
      memoriesCreated: c.memoriesCreated,
      memoriesRefined: c.memoriesRefined,
      knowledgeFilesUpdated: c.knowledgeFilesUpdated,
      soulUpdated: c.soulUpdated,
      userProfileUpdated: c.userProfileUpdated,
      insights: c.insights,
      errors: c.errors,
      processedSessionIds: c.processedSessionIds,
    }));

    return { cycles: summaries, total };
  }

  /** 清理旧梦境周期记录（保留最近 100 条或 30 天内） */
  async pruneOldCycles(): Promise<number> {
    const { readdir, unlink } = await import('fs/promises');
    const cyclesDir = this.getCyclesDir();

    let files: string[];
    try {
      files = await readdir(cyclesDir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        void handleError(e instanceof Error ? e : new Error(String(e)), {
          module: 'dream:persistence',
          action: 'pruneOldCyclesReadDir',
        });
      }
      return 0;
    }

    const cycleFiles = files.filter((f) => f.endsWith('.json'));
    const cycles: { file: string; record: DreamCycleRecord }[] = [];

    for (const file of cycleFiles) {
      try {
        const data = await readFile(join(cyclesDir, file), 'utf-8');
        cycles.push({ file, record: JSON.parse(data) as DreamCycleRecord });
      } catch {
        void handleError(new Error('清理周期：解析文件失败'), {
          module: 'dream:persistence',
          action: 'pruneOldCyclesParse',
        });
        // 损坏文件直接删除
        try {
          await unlink(join(cyclesDir, file));
        } catch {
          void handleError(new Error('清理周期：删除损坏文件失败'), {
            module: 'dream:persistence',
            action: 'pruneOldCyclesUnlinkDamaged',
          });
        }
      }
    }

    const now = Date.now();
    const toDelete: string[] = [];

    for (const { file, record } of cycles) {
      const age = now - record.completedAt;
      if (age > CYCLES_MAX_AGE_MS) {
        toDelete.push(file);
      }
    }

    // 如果超龄删除后还超过 CYCLES_MAX，按时间排序保留最近 100 条
    const remaining = cycles.filter((c) => !toDelete.includes(c.file));
    if (remaining.length > CYCLES_MAX) {
      remaining.sort((a, b) => a.record.completedAt - b.record.completedAt);
      const overflow = remaining.slice(0, remaining.length - CYCLES_MAX);
      for (const c of overflow) {
        toDelete.push(c.file);
      }
    }

    for (const file of toDelete) {
      try {
        await unlink(join(cyclesDir, file));
      } catch {
        void handleError(new Error('清理周期：删除过期文件失败'), {
          module: 'dream:persistence',
          action: 'pruneOldCyclesUnlinkExpired',
        });
      }
    }

    if (toDelete.length > 0) {
      logger.info(
        `[DreamPersistence] 清理 ${toDelete.length} 条旧梦境周期记录`
      );
    }
    return toDelete.length;
  }
}
