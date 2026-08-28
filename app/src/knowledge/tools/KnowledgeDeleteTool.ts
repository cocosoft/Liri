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
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { globalEventBus } from '@modules/core';
import { writeAuditLog } from '../KnowledgeAuditLogger';

const logger = getLogger('knowledge:tools:knowledgeDeleteTool');

export class KnowledgeDeleteTool implements Tool {
  public name: string = 'knowledge_delete';
  public description: string =
    'Delete a knowledge base document by title or path. If multiple documents match the title, a candidate list is returned — pick the exact one and call again with the specific docPath. Requires explicit confirmation.';
  public params: ToolParam[] = [
    {
      name: 'title',
      type: 'string',
      description:
        'Title of the document to delete. If multiple matches, candidates are returned.',
      required: false,
    },
    {
      name: 'docPath',
      type: 'string',
      description:
        'Exact relative path of the document to delete. Use this when candidates are returned from a previous title-based lookup.',
      required: false,
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
    const docPath = ((input.docPath as string) || '').trim();
    const confirm = input.confirm === true;

    if (!title && !docPath) {
      return {
        status: ToolExecutionStatus.FAILURE,
        error:
          'Either title or docPath is required. Use title for lookup, docPath for exact deletion.',
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
      // 优先使用 docPath 精确删除
      if (docPath) {
        return await this.deleteByPath(docPath, startTime);
      }

      // 使用标题查找
      const lowerTitle = title.toLowerCase();
      const doc = knowledgeRouter.findByTitle(title);

      if (doc) {
        return await this.deleteByDoc(doc, startTime);
      }

      // 无精确匹配 → 模糊搜索返回候选列表
      const docs = await knowledgeDocsProvider.buildIndex();
      const candidates = docs.filter(
        (d) =>
          d.title.toLowerCase().includes(lowerTitle) ||
          d.fileName.toLowerCase().includes(lowerTitle)
      );

      if (candidates.length === 0) {
        await writeAuditLog({
          timestamp: Date.now(),
          action: 'delete',
          target: { title, filePath: '' },
          result: 'failure',
          reason: 'not found',
        });
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

      // 返回候选列表，要求 AI 精确指定
      const candidateList = candidates.map((c) => ({
        title: c.title,
        docPath: c.relativePath,
      }));

      return {
        status: ToolExecutionStatus.SUCCESS,
        result: candidateList,
        output: JSON.stringify(candidateList),
        error: '',
        errorOutput: '',
        progress: [],
        metadata: { candidates: candidateList.length },
        executionTime: Date.now() - startTime,
        executionId: `knowledge_delete_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
        content: `找到 ${candidates.length} 个匹配文档，请指定精确的 docPath 后重新调用:\n${candidateList.map((c) => `  - "${c.title}" → docPath: "${c.docPath}"`).join('\n')}`,
      };
    } catch (error) {
      await handleError(error, {
        module: 'knowledge:tool',
        action: 'delete',
        context: { title, docPath },
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

  /**
   * 通过 docPath 精确删除文档
   */
  private async deleteByPath(
    docPath: string,
    startTime: number
  ): Promise<ToolResult> {
    const docs = await knowledgeDocsProvider.buildIndex();
    const doc = docs.find((d) => d.relativePath === docPath);

    if (!doc) {
      await writeAuditLog({
        timestamp: Date.now(),
        action: 'delete',
        target: { title: docPath, filePath: docPath },
        result: 'failure',
        reason: 'path not found',
      });
      return {
        status: ToolExecutionStatus.FAILURE,
        error: `Document at path "${docPath}" not found.`,
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
      doc.source || knowledgeDocsProvider.getDocsRoots()[0],
      doc.relativePath
    );
    await unlink(filePath);
    knowledgeDocsProvider.clearCache();

    globalEventBus.publish('knowledge:changed', {
      action: 'deleted',
      filePath,
    });
    await writeAuditLog({
      timestamp: Date.now(),
      action: 'delete',
      target: { title: doc.title, filePath },
      result: 'success',
    });

    logger.info('知识文档已删除', { title: doc.title, filePath });

    return {
      status: ToolExecutionStatus.SUCCESS,
      result: { title: doc.title, filePath },
      output: `Document "${doc.title}" deleted successfully.`,
      executionTime: Date.now() - startTime,
      error: '',
      errorOutput: '',
      progress: [],
      metadata: { title: doc.title, filePath },
      executionId: `knowledge_delete_${Date.now()}`,
      toolName: this.name,
      timestamp: Date.now(),
      content: `知识文档已删除：${doc.title}`,
    };
  }

  /**
   * 通过 WeightedDoc 精确删除文档
   */
  private async deleteByDoc(
    doc: { title: string; docPath: string; source?: string },
    startTime: number
  ): Promise<ToolResult> {
    const filePath = join(
      doc.source || knowledgeDocsProvider.getDocsRoots()[0],
      doc.docPath
    );

    await unlink(filePath);
    knowledgeDocsProvider.clearCache();

    globalEventBus.publish('knowledge:changed', {
      action: 'deleted',
      filePath,
    });
    await writeAuditLog({
      timestamp: Date.now(),
      action: 'delete',
      target: { title: doc.title, filePath },
      result: 'success',
    });

    logger.info('知识文档已删除', { title: doc.title, filePath });

    return {
      status: ToolExecutionStatus.SUCCESS,
      result: { title: doc.title, filePath },
      executionTime: Date.now() - startTime,
      output: `Document "${doc.title}" deleted successfully.`,
      errorOutput: '',
      progress: [],
      metadata: { title: doc.title, filePath },
      executionId: `knowledge_delete_${Date.now()}`,
      toolName: this.name,
      timestamp: Date.now(),
      content: `知识文档已删除：${doc.title}`,
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

export function createKnowledgeDeleteTool(): Tool {
  return new KnowledgeDeleteTool();
}
