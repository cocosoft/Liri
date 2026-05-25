import { Tool, ToolParam, ToolInfo } from '../../tools/types/Tool';
import { ToolResult, ToolExecutionStatus } from '../../tools/types/ToolResult';
import { ToolUseContext } from '../../tools/types/ToolUseContext';
import {
  type IKnowledgeSearch,
  KnowledgeRouter,
  KnowledgeRoute,
} from '../../docs/KnowledgeRouter';
import type { AIService } from '@modules/ai/models/types';
import { AIMessageRole } from '@modules/ai/models/types';
import { KnowledgeBaseWriter } from '../services/KnowledgeBaseWriter';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

export class KnowledgeSearchTool implements Tool {
  public name: string = 'knowledge_search';
  public description: string =
    'Search and retrieve documents from the knowledge base. Use this to find documentation, guides, API references, and wiki articles.';
  public params: ToolParam[] = [
    {
      name: 'query',
      type: 'string',
      description: 'Search query for knowledge base documents',
      required: true,
    },
    {
      name: 'limit',
      type: 'number',
      description: 'Maximum number of results to return',
      required: false,
      default: 5,
    },
    {
      name: 'minScore',
      type: 'number',
      description:
        'Minimum relevance score (0-1), lower values return more results',
      required: false,
      default: 0.1,
    },
    {
      name: 'autoWrite',
      type: 'boolean',
      description:
        'Auto-write new knowledge when search results are insufficient',
      required: false,
      default: false,
    },
  ];
  public aliases: string[] = ['knowledge', 'docs_search', 'find_doc'];
  public searchTips: string[] = [
    'knowledge',
    'docs',
    'documentation',
    'guide',
    'api',
    'reference',
    'wiki',
  ];
  public isEnabled: () => boolean = () => true;
  public isReadOnly: () => boolean = () => true;
  public isDestructive: () => boolean = () => false;
  public isConcurrencySafe: () => boolean = () => true;

  private router: IKnowledgeSearch;
  private aiService?: AIService;
  private writer?: KnowledgeBaseWriter;

  constructor(router: IKnowledgeSearch, aiService?: AIService) {
    this.router = router;
    this.aiService = aiService;
    if (aiService) {
      this.writer = new KnowledgeBaseWriter();
    }
  }

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult<KnowledgeRoute[]>> {
    const startTime = Date.now();
    const query = input.query as string;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return {
        status: ToolExecutionStatus.FAILURE,
        error: 'query is required and must be a non-empty string',
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: '',
        progress: [],
        metadata: {},
        executionId: `knowledge_search_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }

    try {
      const limit = (input.limit as number) ?? 5;
      const minScore = (input.minScore as number) ?? 0.1;
      const autoWrite = (input.autoWrite as boolean) ?? false;

      const results = await this.router.search(query.trim(), {
        maxResults: limit,
        minScore,
      });

      const metadata: Record<string, unknown> = {
        count: results.length,
        query: query.trim(),
      };

      // Auto-write: 搜索结果不足时自动生成新知识
      if (autoWrite && results.length < 3 && this.aiService && this.writer) {
        try {
          const writeResult = await this.autoWriteKnowledge(query.trim());
          metadata.autoWritten = writeResult.success;
          metadata.autoWriteAction = writeResult.action;
          metadata.autoWritePath = writeResult.filePath;
        } catch (writeError) {
          logger.warning('自动写入知识失败', {
            query,
            error:
              writeError instanceof Error
                ? writeError.message
                : String(writeError),
          });
          metadata.autoWriteError = String(writeError);
        }
      }

      return {
        status: ToolExecutionStatus.SUCCESS,
        result: results,
        executionTime: Date.now() - startTime,
        output: JSON.stringify(results),
        errorOutput: '',
        progress: [],
        metadata,
        executionId: `knowledge_search_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        status: ToolExecutionStatus.FAILURE,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
        output: '',
        errorOutput: error instanceof Error ? error.stack || '' : String(error),
        progress: [],
        metadata: {},
        executionId: `knowledge_search_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * 当搜索结果不足时，使用 LLM 生成新知识并写入知识库
   */
  private async autoWriteKnowledge(query: string) {
    if (!this.aiService || !this.writer) {
      return { success: false, action: 'skipped' as const, filePath: '' };
    }

    const response = await this.aiService.generate([
      {
        role: AIMessageRole.SYSTEM,
        content:
          '你是一个知识库自动编写助手。根据用户查询，生成一篇结构化的知识文档。' +
          '请以 Markdown 格式输出，包含概述和详细内容。不要包含 frontmatter。',
        timestamp: Date.now(),
      },
      {
        role: AIMessageRole.USER,
        content: `请为 "${query}" 撰写知识库文档`,
        timestamp: Date.now(),
      },
    ]);

    const content = response.content.trim();

    const writeResult = await this.writer.writeEntry({
      title: query,
      content,
      category: '知识库',
      tags: [query],
      source: 'auto-write',
    });

    logger.info('自动写入知识完成', {
      query,
      action: writeResult.action,
      path: writeResult.filePath,
    });

    return writeResult;
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

export function createKnowledgeSearchTool(router: IKnowledgeSearch): Tool {
  return new KnowledgeSearchTool(router);
}
