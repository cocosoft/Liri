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
 * KnowledgeDeleteTool — AI 会话中删除知识文档
 *
 * 迁移自 memory/tools/KnowledgeDeleteTool.ts。
 */

import { Tool, ToolParam, ToolInfo } from '../../tools/types/Tool';
import { ToolResult, ToolExecutionStatus } from '../../tools/types/ToolResult';
import { ToolUseContext } from '../../tools/types/ToolUseContext';
import { knowledgeDocsProvider } from '../../docs/FileDocsProvider';
import { knowledgeRouter } from '../KnowledgeRouter';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { globalEventBus } from '@modules/core';

const logger = new Logger({
  module: 'knowledge:tools:knowledgeDeleteTool',
  level: LogLevel.INFO,
});

export class KnowledgeDeleteTool implements Tool {
  public name: string = 'knowledge_delete';
  public description: string =
    'Delete a knowledge base document by title. Use this to remove outdated or incorrect knowledge. Requires explicit confirmation.';
  public params: ToolParam[] = [
    {
      name: 'title',
      type: 'string',
      description: 'Title of the document to delete',
      required: true,
    },
    {
      name: 'confirm',
      type: 'boolean',
      description:
        'Must be set to true to confirm deletion. This is a safety measure.',
      required: true,
    },
  ];
  public aliases: string[] = ['knowledge_remove', 'kb_delete'];
  public searchTips: string[] = ['knowledge', 'delete', 'remove'];
  public isEnabled: () => boolean = () => true;
  public isReadOnly: () => boolean = () => false;
  public isDestructive: () => boolean = () => true;
  public isConcurrencySafe: () => boolean = () => false;

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const title = ((input.title as string) || '').trim();
    const confirm = input.confirm === true;

    if (!title) {
      return {
        status: ToolExecutionStatus.FAILURE,
        error: 'title is required and must be a non-empty string',
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: '',
        progress: [],
        metadata: {},
        executionId: `knowledge_delete_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }

    if (!confirm) {
      return {
        status: ToolExecutionStatus.FAILURE,
        error:
          'Deletion requires explicit confirmation. Set confirm=true to proceed.',
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: '',
        progress: [],
        metadata: {},
        executionId: `knowledge_delete_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }

    try {
      // 使用共享 KnowledgeRouter 的 O(1) 标题索引查找
      const lowerTitle = title.toLowerCase();
      const doc = knowledgeRouter.findByTitle(title);

      if (!doc) {
        // 回退：通过文件系统查找（兼容 Router 索引未构建的场景）
        const docs = await knowledgeDocsProvider.buildIndex();
        const fallback = docs.find(
          (d) =>
            d.title.toLowerCase() === lowerTitle ||
            d.fileName.toLowerCase().replace(/\.md$/i, '') === lowerTitle
        );

        if (!fallback) {
          return {
            status: ToolExecutionStatus.FAILURE,
            error: `Document "${title}" not found in knowledge base.`,
            executionTime: Date.now() - startTime,
            output: '',
            errorOutput: '',
            progress: [],
            metadata: {},
            executionId: `knowledge_delete_${Date.now()}`,
            toolName: this.name,
            timestamp: Date.now(),
          };
        }

        const filePath = join(
          fallback.source || knowledgeDocsProvider.getDocsRoots()[0],
          fallback.relativePath
        );
        await unlink(filePath);
        knowledgeDocsProvider.clearCache();

        globalEventBus.publish('knowledge:changed', {
          action: 'deleted',
          filePath,
        });

        logger.info('知识文档已删除', { title: fallback.title, filePath });

        return {
          status: ToolExecutionStatus.SUCCESS,
          output: `Document "${fallback.title}" deleted successfully.`,
          executionTime: Date.now() - startTime,
          error: '',
          errorOutput: '',
          progress: [],
          metadata: { title: fallback.title, filePath },
          executionId: `knowledge_delete_${Date.now()}`,
          toolName: this.name,
          timestamp: Date.now(),
          content: `知识文档已删除：${fallback.title}`,
        };
      }

      const filePath = join(
        doc.source || knowledgeDocsProvider.getDocsRoots()[0],
        doc.docPath
      );

      await unlink(filePath);
      knowledgeDocsProvider.clearCache();

      // 广播知识变更事件，触发下游索引联动
      globalEventBus.publish('knowledge:changed', {
        action: 'deleted',
        filePath,
      });

      logger.info('知识文档已删除', { title: doc.title, filePath });

      return {
        status: ToolExecutionStatus.SUCCESS,
        executionTime: Date.now() - startTime,
        output: `Document "${doc.title}" deleted successfully.`,
        errorOutput: '',
        progress: [],
        metadata: {
          title: doc.title,
          filePath,
        },
        executionId: `knowledge_delete_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
        content: `知识文档已删除：${doc.title}`,
      };
    } catch (error) {
      await handleError(error, {
        module: 'knowledge:tool',
        action: 'delete',
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
        executionId: `knowledge_delete_${Date.now()}`,
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

export function createKnowledgeDeleteTool(): Tool {
  return new KnowledgeDeleteTool();
}
