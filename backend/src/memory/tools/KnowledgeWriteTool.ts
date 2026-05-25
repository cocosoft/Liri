/**
 * KnowledgeWriteTool — AI 会话中创建/编辑知识文档
 */
import { Tool, ToolParam, ToolInfo } from '../../tools/types/Tool';
import { ToolResult, ToolExecutionStatus } from '../../tools/types/ToolResult';
import { ToolUseContext } from '../../tools/types/ToolUseContext';
import { KnowledgeBaseWriter } from '../services/KnowledgeBaseWriter';
import { knowledgeDocsProvider } from '../../docs/FileDocsProvider';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

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
    this.writer = new KnowledgeBaseWriter();
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
      logger.error('知识文档写入失败', {
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
