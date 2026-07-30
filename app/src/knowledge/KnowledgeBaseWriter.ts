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
 * 知识库写入器
 *
 * 迁移自 memory/services/KnowledgeBaseWriter.ts。
 * 写入知识文件后广播 knowledge:changed 事件，触发索引联动。
 */

import { join } from 'path';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { resolvePyappHome } from '@modules/core';
import type { EventBus } from '@modules/core';
import { KnowledgeDedupStrategy } from '@modules/knowledge/KnowledgeDedupStrategy';

export interface KnowledgeBaseEntry {
  title: string;
  content: string;
  category: string;
  tags: string[];
  source: string;
}

export interface WriteResult {
  success: boolean;
  filePath: string;
  action: 'created' | 'updated' | 'skipped';
  error?: string;
}

export class KnowledgeBaseWriter {
  private baseDir: string;
  private logger: Logger;
  private eventBus?: EventBus;
  private dedup?: KnowledgeDedupStrategy;
  /** 每个文档保留的最大快照数 */
  private maxSnapshots: number;

  constructor(
    baseDir?: string,
    eventBus?: EventBus,
    maxSnapshots: number = 10
  ) {
    this.baseDir = baseDir || join(resolvePyappHome(), 'knowledge');
    this.logger = new Logger({ level: LogLevel.INFO });
    this.eventBus = eventBus;
    this.maxSnapshots = maxSnapshots;
  }

  /** 设置去重策略（可选） */
  setDedup(dedup: KnowledgeDedupStrategy): void {
    this.dedup = dedup;
  }

  async writeEntry(entry: KnowledgeBaseEntry): Promise<WriteResult> {
    const fileName = this.sanitizeFileName(entry.title) + '.md';
    const filePath = join(this.baseDir, fileName);

    try {
      await this.ensureDir();

      const frontmatter = this.buildFrontmatter({
        title: entry.title,
        tags: entry.tags,
        category: entry.category,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: entry.source,
      });

      const fullContent = `${frontmatter}\n\n${entry.content}\n`;

      const exists = existsSync(filePath);
      let action: WriteResult['action'] = 'skipped';

      // 去重检查：写入新文件时检测是否与已有文档重复
      if (!exists && this.dedup) {
        const dedupResult = await this.dedup.check(entry.title, entry.content);
        if (dedupResult.isDuplicate) {
          return {
            success: false,
            filePath,
            action: 'skipped',
            error: `内容与已有文档 "${dedupResult.existingTitle}" 重复 (相似度: ${(dedupResult.similarity * 100).toFixed(0)}%)`,
          };
        }
      }

      if (exists) {
        const existing = await readFile(filePath, 'utf-8');
        const existingContent = this.stripFrontmatter(existing);

        if (existingContent.trim() === entry.content.trim()) {
          return { success: true, filePath, action: 'skipped' };
        }

        // 更新前创建快照
        await this.createSnapshot(fileName, existing);

        await writeFile(filePath, fullContent, 'utf-8');
        action = 'updated';
      } else {
        await writeFile(filePath, fullContent, 'utf-8');
        action = 'created';
      }

      // 广播知识变更事件，触发索引联动
      this.eventBus?.publish('knowledge:changed', {
        action,
        filePath,
      });

      return { success: true, filePath, action };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      await handleError(error, {
        module: 'knowledge:writer',
        action: 'write_entry',
        context: { filePath },
      });
      return {
        success: false,
        filePath,
        action: 'skipped',
        error: errMsg,
      };
    }
  }

  /**
   * 获取文档的快照目录路径
   */
  getSnapshotDir(title: string): string {
    const fileName = this.sanitizeFileName(title);
    return join(this.baseDir, '.knowledge-snapshots', fileName);
  }

  /**
   * 列出文档的所有快照文件
   */
  async listSnapshots(title: string): Promise<string[]> {
    const snapDir = this.getSnapshotDir(title);
    if (!existsSync(snapDir)) return [];
    try {
      const { readdir } = await import('fs/promises');
      const entries = await readdir(snapDir);
      return entries
        .filter((e) => e.startsWith('snapshot_') && e.endsWith('.md'))
        .sort()
        .reverse(); // 最新在前
    } catch (_err) {
      return [];
    }
  }

  /**
   * 从快照恢复文档
   */
  async restoreSnapshot(
    title: string,
    snapshotFileName: string
  ): Promise<boolean> {
    const snapDir = this.getSnapshotDir(title);
    const snapPath = join(snapDir, snapshotFileName);
    if (!existsSync(snapPath)) return false;

    try {
      const content = await readFile(snapPath, 'utf-8');
      const fileName = this.sanitizeFileName(title) + '.md';
      const filePath = join(this.baseDir, fileName);

      // 恢复前也创建当前版本的快照
      if (existsSync(filePath)) {
        const current = await readFile(filePath, 'utf-8');
        await this.createSnapshot(fileName, current);
      }

      await writeFile(filePath, content, 'utf-8');

      this.eventBus?.publish('knowledge:changed', {
        action: 'created',
        filePath,
      });

      return true;
    } catch (_err) {
      return false;
    }
  }

  /**
   * 创建文档快照
   */
  private async createSnapshot(
    fileName: string,
    content: string
  ): Promise<void> {
    const docName = fileName.replace(/\.md$/i, '');
    const snapDir = join(this.baseDir, '.knowledge-snapshots', docName);

    if (!existsSync(snapDir)) {
      await mkdir(snapDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapFile = join(snapDir, `snapshot_${timestamp}.md`);
    await writeFile(snapFile, content, 'utf-8');

    // 清理超出上限的旧快照
    try {
      const { readdir, unlink } = await import('fs/promises');
      const entries = (await readdir(snapDir))
        .filter((e) => e.startsWith('snapshot_') && e.endsWith('.md'))
        .sort(); // 最旧的在前
      while (entries.length > this.maxSnapshots) {
        const oldest = entries.shift();
        if (oldest) {
          await unlink(join(snapDir, oldest));
        }
      }
    } catch (_err) {
      // 清理失败不影响主流程
    }
  }

  private async ensureDir(): Promise<void> {
    if (!existsSync(this.baseDir)) {
      await mkdir(this.baseDir, { recursive: true });
    }
  }

  private sanitizeFileName(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 100);
  }

  private buildFrontmatter(metadata: Record<string, unknown>): string {
    const lines = ['---'];
    for (const [key, value] of Object.entries(metadata)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        lines.push(
          `${key}: [${value.map((v) => JSON.stringify(v)).join(', ')}]`
        );
      } else if (typeof value === 'string') {
        lines.push(`${key}: "${value}"`);
      } else {
        lines.push(`${key}: ${value}`);
      }
    }
    lines.push('---');
    return lines.join('\n');
  }

  private stripFrontmatter(content: string): string {
    const match = content.match(/^---\n[\s\S]*?\n---\n/);
    if (match) {
      return content.slice(match[0].length).trim();
    }
    return content.trim();
  }
}

export function createKnowledgeBaseWriter(
  baseDir?: string,
  eventBus?: EventBus
): KnowledgeBaseWriter {
  return new KnowledgeBaseWriter(baseDir, eventBus);
}
