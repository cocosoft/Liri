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

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { handleError } from '@modules/error/handleError';
import { resolvePyappHome } from '@modules/core/paths';
import type { EventBus } from '@modules/core/events/EventBus';

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

  constructor(baseDir?: string, eventBus?: EventBus) {
    this.baseDir = baseDir || join(resolvePyappHome(), 'knowledge');
    this.logger = new Logger({ level: LogLevel.INFO });
    this.eventBus = eventBus;
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

      if (exists) {
        const existing = await readFile(filePath, 'utf-8');
        const existingContent = this.stripFrontmatter(existing);

        if (existingContent.trim() === entry.content.trim()) {
          return { success: true, filePath, action: 'skipped' };
        }

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
