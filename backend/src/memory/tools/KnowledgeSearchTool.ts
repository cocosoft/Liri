import { Tool, ToolParam, ToolInfo } from '../../tools/types/Tool';
import { ToolResult, ToolExecutionStatus } from '../../tools/types/ToolResult';
import { ToolUseContext } from '../../tools/types/ToolUseContext';
import { KnowledgeRouter, KnowledgeRoute } from '../../docs/KnowledgeRouter';

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

  private router: KnowledgeRouter;

  constructor(router: KnowledgeRouter) {
    this.router = router;
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

      const results = await this.router.search(query.trim(), {
        maxResults: limit,
        minScore,
      });

      return {
        status: ToolExecutionStatus.SUCCESS,
        result: results,
        executionTime: Date.now() - startTime,
        output: JSON.stringify(results),
        errorOutput: '',
        progress: [],
        metadata: {
          count: results.length,
          query: query.trim(),
        },
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

export function createKnowledgeSearchTool(router: KnowledgeRouter): Tool {
  return new KnowledgeSearchTool(router);
}
