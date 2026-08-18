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
 * KnowledgeWriteTool — AI 会话中创建/编辑知识文档
 *
 * 迁移自 memory/tools/KnowledgeWriteTool.ts。
 */

import { Tool, ToolParam, ToolInfo } from '../../tools/types/Tool';
import { ToolResult, ToolExecutionStatus } from '../../tools/types/ToolResult';
import { ToolUseContext } from '../../tools/types/ToolUseContext';
import { KnowledgeBaseWriter } from '../KnowledgeBaseWriter';
import { knowledgeDocsProvider } from '../../docs/FileDocsProvider';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { globalEventBus } from '@modules/core';
import { writeAuditLog } from '../KnowledgeAuditLogger';
import { existsSync } from 'fs';
import { join } from 'path';
import { resolvePyappHome } from '@modules/core';
import { sanitizeFileName } from '@modules/services/file/fileNaming';

const logger = getLogger('knowledge:tools:knowledgeWriteTool');

export class KnowledgeWriteTool implements Tool {
  public name: string = 'knowledge_write';
  public description: string =
    'Create or update a knowledge base document. Use this to persist important information, notes, and learnings as structured knowledge documents.';
  public params: ToolParam[] = [
    {
      name: 'title',
      type: 'string',
      description: 'Document title',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'Document content in Markdown format',
      required: true,
    },
    {
      name: 'category',
      type: 'string',
      description: 'Document category (e.g. "技术", "项目", "学习笔记")',
      required: false,
    },
    {
      name: 'tags',
      type: 'string',
      description: 'Comma-separated tags for the document',
      required: false,
    },
  ];
  public aliases: string[] = ['knowledge_create', 'kb_write', 'note_create'];
  public searchTips: string[] = ['knowledge', 'write', 'create', 'save note'];
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
    const title = input.title as string;
    const content = input.content as string;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return {
        status: ToolExecutionStatus.FAILURE,
        error: 'title is required and must be a non-empty string',
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: '',
        progress: [],
        metadata: {},
        executionId: `knowledge_write_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }

    if (
      !content ||
      typeof content !== 'string' ||
      content.trim().length === 0
    ) {
      return {
        status: ToolExecutionStatus.FAILURE,
        error: 'content is required and must be a non-empty string',
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: '',
        progress: [],
        metadata: {},
        executionId: `knowledge_write_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }

    try {
      const category = (input.category as string) || '知识库';
      const tagsRaw = (input.tags as string) || '';
      const tags = tagsRaw
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      // ── 审批检查：检测是否覆盖已有文档 ──
      const sanitizedTitle = sanitizeFileName(title.trim());
      const knowledgeRoot = join(resolvePyappHome(), 'knowledge');
      const targetPath = join(knowledgeRoot, `${sanitizedTitle}.md`);
      const isOverwrite = existsSync(targetPath);

      if (isOverwrite) {
        const executionTime = Date.now() - startTime;
        return {
          status: ToolExecutionStatus.REQUIRES_APPROVAL,
          requireApproval: true,
          approvalReason: `将覆盖已有知识文档「${title.trim()}」`,
          executionTime,
          output: `⚠ 文档「${title.trim()}」已存在，需要审批确认后才能覆盖。`,
          errorOutput: '',
          progress: [],
          metadata: {
            title: title.trim(),
            action: 'update_pending_approval',
            targetPath,
            category,
          },
          executionId: `knowledge_write_${Date.now()}`,
          toolName: this.name,
          timestamp: Date.now(),
          content: `知识文档「${title.trim()}」已存在，等待审批确认覆盖。`,
        };
      }

      const result = await this.writer.writeEntry({
        title: title.trim(),
        content: content.trim(),
        category,
        tags,
        source: 'ai-write',
      });

      knowledgeDocsProvider.clearCache();

      logger.info('知识文档写入完成', {
        title,
        action: result.action,
        path: result.filePath,
      });

      // 记录审计日志
      await writeAuditLog({
        timestamp: Date.now(),
        action: result.action === 'created' ? 'create' : 'update',
        target: { title: title.trim(), filePath: result.filePath },
        result: 'success',
      });

      const actionLabel =
        result.action === 'created'
          ? '创建'
          : result.action === 'updated'
            ? '更新'
            : '跳过';

      return {
        status: ToolExecutionStatus.SUCCESS,
        result,
        executionTime: Date.now() - startTime,
        output: JSON.stringify(result),
        errorOutput: '',
        progress: [],
        metadata: {
          title: title.trim(),
          action: result.action,
          filePath: result.filePath,
          category,
        },
        executionId: `knowledge_write_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
        content: `${actionLabel}知识文档成功：${title.trim()}`,
      };
    } catch (error) {
      await handleError(error, {
        module: 'knowledge:tool',
        action: 'write',
        context: { title },
      });
      return {
        status: ToolExecutionStatus.FAILURE,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: error instanceof Error ? error.stack || '' : String(error),
        progress: [],
        metadata: {},
        executionId: `knowledge_write_${Date.now()}`,
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

export function createKnowledgeWriteTool(): Tool {
  return new KnowledgeWriteTool();
}
