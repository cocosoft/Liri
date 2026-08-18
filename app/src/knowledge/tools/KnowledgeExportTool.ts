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
 * KnowledgeExportTool — 导出知识库文档
 *
 * 支持 Markdown（保持原样 + frontmatter）和 JSON（结构化数组）两种格式。
 */
import { Tool, ToolParam, ToolInfo } from '../../tools/types/Tool';
import { ToolResult, ToolExecutionStatus } from '../../tools/types/ToolResult';
import { ToolUseContext } from '../../tools/types/ToolUseContext';
import { knowledgeDocsProvider } from '../../docs/FileDocsProvider';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { resolveDataSubDir } from '@modules/core';
import { sanitizeFileName } from '@modules/services/file/fileNaming';

const logger = getLogger('knowledge:tools:knowledgeExportTool');

export class KnowledgeExportTool implements Tool {
  public name: string = 'knowledge_export';
  public description: string =
    'Export all knowledge base documents to a directory. Supports Markdown (with frontmatter metadata) and JSON (structured array) formats.';
  public params: ToolParam[] = [
    {
      name: 'format',
      type: 'string',
      description:
        "Export format: 'markdown' (one .md per doc) or 'json' (single JSON array)",
      required: true,
    },
    {
      name: 'targetDir',
      type: 'string',
      description:
        'Target directory path for exported files. Defaults to ~/.pyapp/exports/knowledge/.',
      required: false,
    },
  ];
  public aliases: string[] = ['knowledge_backup', 'kb_export'];
  public searchTips: string[] = ['knowledge', 'export', 'backup', 'save'];
  public isEnabled: () => boolean = () => true;
  public isReadOnly: () => boolean = () => true;
  public isDestructive: () => boolean = () => false;
  public isConcurrencySafe: () => boolean = () => false;

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const format = ((input.format as string) || '').toLowerCase();
    const targetDir =
      (input.targetDir as string) ||
      join(resolveDataSubDir(''), '..', '..', 'exports', 'knowledge');

    if (format !== 'markdown' && format !== 'json') {
      return {
        status: ToolExecutionStatus.FAILURE,
        error: 'format must be "markdown" or "json"',
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: '',
        progress: [],
        metadata: {},
        executionId: `knowledge_export_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }

    try {
      await mkdir(targetDir, { recursive: true });
      const docs = await knowledgeDocsProvider.buildIndex();

      if (docs.length === 0) {
        return {
          status: ToolExecutionStatus.SUCCESS,
          output: 'No documents to export.',
          executionTime: Date.now() - startTime,
          error: '',
          errorOutput: '',
          progress: [],
          metadata: { exported: 0 },
          executionId: `knowledge_export_${Date.now()}`,
          toolName: this.name,
          timestamp: Date.now(),
          content: '知识库为空，无文档可导出。',
        };
      }

      if (format === 'json') {
        const exportData = docs.map((d) => ({
          title: d.title,
          content: d.content,
          category: d.category,
        }));
        const jsonPath = join(targetDir, 'knowledge-export.json');
        await writeFile(jsonPath, JSON.stringify(exportData, null, 2), 'utf-8');
        logger.info('知识库已导出为 JSON', {
          path: jsonPath,
          count: docs.length,
        });
      } else {
        for (const doc of docs) {
          const safeName = sanitizeFileName(doc.title).slice(0, 100);
          const filePath = join(targetDir, `${safeName}.md`);
          const frontmatter = [
            '---',
            `title: "${doc.title}"`,
            `category: "${doc.category}"`,
            '---',
          ].join('\n');
          await writeFile(
            filePath,
            `${frontmatter}\n\n${doc.content}\n`,
            'utf-8'
          );
        }
        logger.info('知识库已导出为 Markdown', {
          dir: targetDir,
          count: docs.length,
        });
      }

      return {
        status: ToolExecutionStatus.SUCCESS,
        output: JSON.stringify({ exported: docs.length, targetDir, format }),
        executionTime: Date.now() - startTime,
        error: '',
        errorOutput: '',
        progress: [],
        metadata: { exported: docs.length, targetDir, format },
        executionId: `knowledge_export_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
        content: `已导出 ${docs.length} 篇知识文档到 ${targetDir}（${format} 格式）`,
      };
    } catch (error) {
      await handleError(error, {
        module: 'knowledge:tool',
        action: 'export',
        context: { format, targetDir },
      });
      return {
        status: ToolExecutionStatus.FAILURE,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: error instanceof Error ? error.stack || '' : String(error),
        progress: [],
        metadata: {},
        executionId: `knowledge_export_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }
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

export function createKnowledgeExportTool(): Tool {
  return new KnowledgeExportTool();
}
