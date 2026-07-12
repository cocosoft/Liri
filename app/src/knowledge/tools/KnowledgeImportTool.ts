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
 * KnowledgeImportTool — 批量导入知识库文档
 *
 * 支持 Markdown 目录和 JSON 文件两种格式。
 * 导入后通过 EventBus 触发索引更新。
 */
import { Tool, ToolParam, ToolInfo } from '../../tools/types/Tool';
import { ToolResult, ToolExecutionStatus } from '../../tools/types/ToolResult';
import { ToolUseContext } from '../../tools/types/ToolUseContext';
import { KnowledgeBaseWriter } from '../KnowledgeBaseWriter';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { globalEventBus } from '@modules/core';

const logger = new Logger({
  module: 'knowledge:tools:knowledgeImportTool',
  level: LogLevel.INFO,
});

export class KnowledgeImportTool implements Tool {
  public name: string = 'knowledge_import';
  public description: string =
    'Import knowledge base documents from a directory (Markdown files) or a JSON export file.';
  public params: ToolParam[] = [
    {
      name: 'source',
      type: 'string',
      description:
        'Source path — a directory containing .md files, or a .json export file.',
      required: true,
    },
    {
      name: 'format',
      type: 'string',
      description:
        "Import format. Auto-detected if omitted: 'markdown' for directory of .md files, 'json' for JSON array file.",
      required: false,
    },
  ];
  public aliases: string[] = ['knowledge_restore', 'kb_import'];
  public searchTips: string[] = [
    'knowledge',
    'import',
    'restore',
    'load',
    'batch',
  ];
  public isEnabled: () => boolean = () => true;
  public isReadOnly: () => boolean = () => false;
  public isDestructive: () => boolean = () => false;
  public isConcurrencySafe: () => boolean = () => false;

  private writer: KnowledgeBaseWriter;

  constructor() {
    this.writer = new KnowledgeBaseWriter(undefined, globalEventBus);
  }

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const source = ((input.source as string) || '').trim();
    const format = ((input.format as string) || '').toLowerCase();

    if (!source) {
      return {
        status: ToolExecutionStatus.FAILURE,
        error: 'source path is required',
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: '',
        progress: [],
        metadata: {},
        executionId: `knowledge_import_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }

    try {
      if (!existsSync(source)) {
        return {
          status: ToolExecutionStatus.FAILURE,
          error: `Source path "${source}" does not exist.`,
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: '',
          progress: [],
          metadata: {},
          executionId: `knowledge_import_${Date.now()}`,
          toolName: this.name,
          timestamp: Date.now(),
        };
      }

      // 自动检测格式
      const detectedFormat =
        format || (source.endsWith('.json') ? 'json' : 'markdown');

      if (detectedFormat === 'json') {
        return await this.importJson(source, startTime);
      } else {
        return await this.importMarkdownDir(source, startTime);
      }
    } catch (error) {
      await handleError(error, {
        module: 'knowledge:tool',
        action: 'import',
        context: { source, format },
      });
      return {
        status: ToolExecutionStatus.FAILURE,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: error instanceof Error ? error.stack || '' : String(error),
        progress: [],
        metadata: {},
        executionId: `knowledge_import_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * 从 JSON 文件导入
   */
  private async importJson(
    source: string,
    startTime: number
  ): Promise<ToolResult> {
    const raw = await readFile(source, 'utf-8');
    const docs: Array<{
      title: string;
      content: string;
      category?: string;
      tags?: string[];
    }> = JSON.parse(raw);

    if (!Array.isArray(docs)) {
      return {
        status: ToolExecutionStatus.FAILURE,
        error: 'JSON file must contain an array of documents.',
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: '',
        progress: [],
        metadata: {},
        executionId: `knowledge_import_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }

    let imported = 0;
    let skipped = 0;

    for (const doc of docs) {
      if (!doc.title || !doc.content) {
        skipped++;
        continue;
      }
      await this.writer.writeEntry({
        title: doc.title,
        content: doc.content,
        category: doc.category || '知识库',
        tags: doc.tags || [],
        source: 'import',
      });
      imported++;
    }

    logger.info('JSON 知识库导入完成', { imported, skipped, source });

    return {
      status: ToolExecutionStatus.SUCCESS,
      output: JSON.stringify({ imported, skipped, total: docs.length }),
      executionTime: Date.now() - startTime,
      error: '',
      errorOutput: '',
      progress: [],
      metadata: { imported, skipped },
      executionId: `knowledge_import_${Date.now()}`,
      toolName: this.name,
      timestamp: Date.now(),
      content: `已从 JSON 导入 ${imported} 篇知识文档（${skipped} 篇跳过）`,
    };
  }

  /**
   * 从 Markdown 目录批量导入
   */
  private async importMarkdownDir(
    source: string,
    startTime: number
  ): Promise<ToolResult> {
    const entries = await readdir(source, { withFileTypes: true });
    const mdFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.md'));

    if (mdFiles.length === 0) {
      return {
        status: ToolExecutionStatus.FAILURE,
        error: `No .md files found in "${source}".`,
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: '',
        progress: [],
        metadata: {},
        executionId: `knowledge_import_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }

    let imported = 0;
    let skipped = 0;

    for (const entry of mdFiles) {
      try {
        const filePath = join(source, entry.name);
        const raw = await readFile(filePath, 'utf-8');

        // 解析 frontmatter（若有）
        let title = entry.name.replace(/\.md$/i, '');
        let category = '知识库';
        const tags: string[] = [];
        let content = raw;

        const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
        if (fmMatch) {
          const fmText = fmMatch[1];
          content = raw.slice(fmMatch[0].length).trim();
          for (const line of fmText.split('\n')) {
            const colonIdx = line.indexOf(':');
            if (colonIdx === -1) continue;
            const key = line.slice(0, colonIdx).trim();
            const value = line
              .slice(colonIdx + 1)
              .trim()
              .replace(/^"(.*)"$/, '$1');
            if (key === 'title') title = value;
            else if (key === 'category') category = value;
            else if (key === 'tags') {
              const tagMatch = value.match(/\[(.*)\]/);
              if (tagMatch) {
                tagMatch[1].split(',').forEach((t) => {
                  const clean = t.trim().replace(/^"(.*)"$/, '$1');
                  if (clean) tags.push(clean);
                });
              }
            }
          }
        }

        if (!title || title === entry.name.replace(/\.md$/i, '')) {
          // 无 frontmatter 标题时，用 h1 或文件名
          const h1Match = content.match(/^#\s+(.+)$/m);
          if (h1Match) title = h1Match[1].trim();
        }

        await this.writer.writeEntry({
          title,
          content,
          category,
          tags,
          source: 'import',
        });
        imported++;
      } catch {
        skipped++;
      }
    }

    logger.info('Markdown 知识库导入完成', { imported, skipped, source });

    return {
      status: ToolExecutionStatus.SUCCESS,
      output: JSON.stringify({ imported, skipped, total: mdFiles.length }),
      executionTime: Date.now() - startTime,
      error: '',
      errorOutput: '',
      progress: [],
      metadata: { imported, skipped },
      executionId: `knowledge_import_${Date.now()}`,
      toolName: this.name,
      timestamp: Date.now(),
      content: `已从 ${source} 导入 ${imported} 篇知识文档（${skipped} 篇跳过）`,
    };
  }

  getInfo(): ToolInfo {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      aliases: this.aliases,
      searchTips: this.searchTips,
      enabled: this.isEnabled(),
      readOnly: this.isReadOnly(),
      destructive: this.isDestructive(),
      concurrencySafe: this.isConcurrencySafe(),
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'block',
    };
  }
}

export function createKnowledgeImportTool(): Tool {
  return new KnowledgeImportTool();
}
