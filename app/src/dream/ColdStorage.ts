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
 * ColdStorage — 记忆冷存储归档
 *
 * 将超过 60 天无更新的记忆从活动记忆中移出，
 * 归档到 .cold 文件中，减轻 LLM 上下文膨胀。
 */

import { resolveDataSubDir } from '@modules/core';
import { join } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('dream:coldStorage');

/** 冷存储阈值：60 天无更新 */
const COLD_THRESHOLD_MS = 60 * 24 * 60 * 60 * 1000;

interface ArchivedMemory {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt: number;
}

/**
 * 冷存储管理类
 * 使用 JSON 文件存储归档的记忆
 */
export class ColdStorage {
  private storagePath: string;

  constructor() {
    this.storagePath = join(resolveDataSubDir('dream'), 'cold_memories.json');
  }

  /** 归档单条记忆 */
  async archive(memory: {
    id: string;
    content: string;
    metadata?: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): Promise<void> {
    const entry: ArchivedMemory = {
      id: memory.id,
      content: memory.content,
      metadata: (memory.metadata || {}) as Record<string, unknown>,
      createdAt: memory.createdAt.toISOString(),
      updatedAt: memory.updatedAt.toISOString(),
      archivedAt: Date.now(),
    };

    const existing = await this.readAll();
    const idx = existing.findIndex((m) => m.id === entry.id);
    if (idx >= 0) {
      existing[idx] = entry;
    } else {
      existing.push(entry);
    }
    await this.writeAll(existing);
  }

  /** 恢复单条记忆 */
  async restore(memoryId: string): Promise<ArchivedMemory | null> {
    const existing = await this.readAll();
    const idx = existing.findIndex((m) => m.id === memoryId);
    if (idx < 0) return null;

    const [entry] = existing.splice(idx, 1);
    await this.writeAll(existing);
    return entry;
  }

  /** 从冷存储删除指定记忆 */
  async remove(memoryId: string): Promise<void> {
    const existing = await this.readAll();
    const filtered = existing.filter((m) => m.id !== memoryId);
    if (filtered.length !== existing.length) {
      await this.writeAll(filtered);
    }
  }

  /** 获取所有归档记忆 ID */
  async getArchivedIds(): Promise<Set<string>> {
    const existing = await this.readAll();
    return new Set(existing.map((m) => m.id));
  }

  /** 获取归档记忆总数 */
  async count(): Promise<number> {
    const existing = await this.readAll();
    return existing.length;
  }

  private async readAll(): Promise<ArchivedMemory[]> {
    try {
      const data = await readFile(this.storagePath, 'utf-8');
      return JSON.parse(data) as ArchivedMemory[];
    } catch (err) {
      // 冷存储文件不存在 = 首次运行尚无归档，属正常状态，不报 error
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        void handleError(new Error('读取冷存储文件失败'), {
          module: 'dream:coldstorage',
          action: 'readAll',
        });
      }
      return [];
    }
  }

  private async writeAll(memories: ArchivedMemory[]): Promise<void> {
    await mkdir(join(resolveDataSubDir('dream')), { recursive: true });
    await writeFile(
      this.storagePath,
      JSON.stringify(memories, null, 2),
      'utf-8'
    );
  }
}

/**
 * 清理过期记忆，移入冷存储
 * @param memoryManager MemoryManager 实例
 * @returns 归档的记忆数量
 */
export async function pruneOldMemories(memoryManager: {
  getAllMemories(): Promise<
    Array<{
      id: string;
      content: string;
      metadata: unknown;
      createdAt: Date;
      updatedAt: Date;
    }>
  >;
  deleteMemory(id: string): Promise<void>;
}): Promise<number> {
  const all = await memoryManager.getAllMemories();
  const now = Date.now();
  const coldStorage = new ColdStorage();

  // Phase 1: 收集待归档记忆
  const toArchive: Array<{
    id: string;
    content: string;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  // 获取已归档的 ID 集合（避免重复归档）
  const archivedIds = await coldStorage.getArchivedIds();

  for (const m of all) {
    const age = now - m.updatedAt.getTime();
    if (age > COLD_THRESHOLD_MS && !archivedIds.has(m.id)) {
      // 跳过已标记为弃用的记忆（它们不会出现在活跃记忆中）
      const deprecated = (m.metadata as Record<string, unknown>)?.deprecatedBy;
      if (!deprecated) {
        toArchive.push(m);
      }
    }
  }

  if (toArchive.length === 0) return 0;

  // Phase 2: 全部归档（原子批处理）
  const archiveResults = await Promise.allSettled(
    toArchive.map((m) => coldStorage.archive(m))
  );

  const succeeded: typeof toArchive = [];
  for (let i = 0; i < toArchive.length; i++) {
    if (archiveResults[i].status === 'fulfilled') {
      succeeded.push(toArchive[i]);
    }
  }

  // Phase 3: 归档成功的才删除
  const deleteResults = await Promise.allSettled(
    succeeded.map((m) => memoryManager.deleteMemory(m.id))
  );

  let deletedCount = 0;
  for (const result of deleteResults) {
    if (result.status === 'fulfilled') {
      deletedCount++;
    }
  }

  if (deletedCount > 0) {
    logger.info(`[ColdStorage] 已将 ${deletedCount} 条旧记忆归档到冷存储`);
  }

  return deletedCount;
}
