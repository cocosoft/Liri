import { join } from 'path';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import type { Memory } from '../types/Memory';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { handleError } from '@modules/error/handleError';
import { resolvePyappHome } from '@modules/core/paths';

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

  constructor(baseDir?: string) {
    this.baseDir = baseDir || join(resolvePyappHome(), 'knowledge');
    this.logger = new Logger({ level: LogLevel.INFO });
  }

  async writeFromMemory(memory: Memory): Promise<WriteResult> {
    const title = memory.metadata?.name || `memory-${memory.id}`;
    const fileName = this.sanitizeFileName(title) + '.md';
    const filePath = join(this.baseDir, fileName);

    try {
      await this.ensureDir();

      const frontmatter = this.buildFrontmatter({
        title,
        tags: memory.metadata?.tags || [],
        type: memory.metadata?.type || 'unknown',
        createdAt: memory.createdAt?.toISOString() || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sourceId: memory.id,
        source: 'auto-memory',
      });

      const fullContent = `${frontmatter}\n\n${memory.content}\n`;

      const exists = existsSync(filePath);
      if (exists) {
        const existing = await readFile(filePath, 'utf-8');
        const existingContent = this.stripFrontmatter(existing);

        if (existingContent.trim() === memory.content.trim()) {
          return {
            success: true,
            filePath,
            action: 'skipped',
          };
        }

        await writeFile(filePath, fullContent, 'utf-8');
        this.logger.info('知识库文档已更新', { filePath, title });
        return {
          success: true,
          filePath,
          action: 'updated',
        };
      }

      await writeFile(filePath, fullContent, 'utf-8');
      this.logger.info('知识库文档已创建', { filePath, title });
      return {
        success: true,
        filePath,
        action: 'created',
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      await handleError(error, {
        module: 'memory:kb:writer',
        action: 'write',
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
      if (exists) {
        const existing = await readFile(filePath, 'utf-8');
        const existingContent = this.stripFrontmatter(existing);

        if (existingContent.trim() === entry.content.trim()) {
          return { success: true, filePath, action: 'skipped' };
        }

        await writeFile(filePath, fullContent, 'utf-8');
        return { success: true, filePath, action: 'updated' };
      }

      await writeFile(filePath, fullContent, 'utf-8');
      return { success: true, filePath, action: 'created' };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      await handleError(error, {
        module: 'memory:kb:writer',
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
  baseDir?: string
): KnowledgeBaseWriter {
  return new KnowledgeBaseWriter(baseDir);
}
