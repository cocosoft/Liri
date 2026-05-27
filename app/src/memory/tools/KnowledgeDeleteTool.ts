/**
 * KnowledgeDeleteTool — AI 会话中删除知识文档
 */
import { Tool, ToolParam, ToolInfo } from '../../tools/types/Tool';
import { ToolResult, ToolExecutionStatus } from '../../tools/types/ToolResult';
import { ToolUseContext } from '../../tools/types/ToolUseContext';
import { knowledgeDocsProvider } from '../../docs/FileDocsProvider';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

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
      const docs = await knowledgeDocsProvider.buildIndex();
      const lowerTitle = title.toLowerCase();

      const doc = docs.find(
        (d) =>
          d.title.toLowerCase() === lowerTitle ||
          d.fileName.toLowerCase().replace(/\.md$/i, '') === lowerTitle
      );

      if (!doc) {
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
        doc.source || knowledgeDocsProvider.getDocsRoots()[0],
        doc.relativePath
      );

      await unlink(filePath);
      knowledgeDocsProvider.clearCache();

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
      logger.error('知识文档删除失败', {
        title,
        error: error instanceof Error ? error.message : String(error),
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
