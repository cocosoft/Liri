import type { Tool } from '../../tools/types/Tool';
import { ToolResult, ToolExecutionStatus } from '../../tools/types/ToolResult';
import type { ToolUseContext } from '../../tools/types/ToolUseContext';
import { MemoryManagerImpl } from '../MemoryManager';
import { Memory } from '../types/Memory';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'memory:tools:MemoryGetTool', level: LogLevel.INFO });

export class MemoryGetTool implements Tool {
  public name: string = 'memory_get';
  public description: string = 'Read stored memory entries';
  public params = [
    {
      name: 'id',
      type: 'string' as const,
      description: 'Specific memory ID to retrieve. If omitted, lists entries.',
      required: false,
      example: 'mem_abc123',
    },
    {
      name: 'type',
      type: 'string' as const,
      description: 'Memory type filter (conversation|fact|preference|learning)',
      required: false,
      example: 'fact',
    },
    {
      name: 'tags',
      type: 'array' as const,
      description: 'Tags to filter memories by',
      required: false,
      example: ['important'],
    },
    {
      name: 'limit',
      type: 'number' as const,
      description: 'Maximum number of results to return (default: 20)',
      required: false,
      default: 20,
      example: 10,
    },
  ];
  public aliases: string[] = ['get_memory', 'read_memory', 'list_memories'];
  public searchTips: string[] = [
    'get',
    'read',
    'list',
    'memory',
    'memories',
    'show',
  ];
  public concurrentSafe: boolean = true;

  private memoryManager: MemoryManagerImpl;

  constructor(memoryManager: MemoryManagerImpl) {
    this.memoryManager = memoryManager;
  }

  async execute(
    input: Record<string, unknown>,
    context: ToolUseContext
  ): Promise<ToolResult<unknown>> {
    const startTime = Date.now();

    try {
      const id = input.id as string | undefined;
      const type = input.type as string | undefined;
      const tags = input.tags as string[] | undefined;
      const limit = (input.limit as number) || 20;

      if (id) {
        const memory = await this.memoryManager.getMemory(id);
        const executionTime = Date.now() - startTime;

        if (!memory) {
          return {
            status: ToolExecutionStatus.SUCCESS,
            result: null,
            error: undefined,
            executionTime,
            output: JSON.stringify({
              found: false,
              message: `Memory with id '${id}' not found`,
            }),
            errorOutput: '',
            progress: [],
            metadata: { id, found: false },
            executionId: `memory_get_${Date.now()}`,
            toolName: this.name,
            timestamp: Date.now(),
          };
        }

        return {
          status: ToolExecutionStatus.SUCCESS,
          result: memory,
          error: undefined,
          executionTime,
          output: JSON.stringify(memory),
          errorOutput: '',
          progress: [],
          metadata: { id, found: true },
          executionId: `memory_get_${Date.now()}`,
          toolName: this.name,
          timestamp: Date.now(),
        };
      }

      let memories = await this.memoryManager.getAllMemories();

      if (type) {
        memories = memories.filter((m: Memory) => m.metadata.type === type);
      }

      if (tags && tags.length > 0) {
        memories = memories.filter(
          (m: Memory) =>
            m.metadata.tags &&
            tags.every((tag: string) => m.metadata.tags!.includes(tag))
        );
      }

      memories = memories.slice(0, limit);

      const executionTime = Date.now() - startTime;

      return {
        status: ToolExecutionStatus.SUCCESS,
        result: memories,
        error: undefined,
        executionTime,
        output: JSON.stringify(memories),
        errorOutput: '',
        progress: [],
        metadata: {
          count: memories.length,
          total: 0,
          type: type || 'all',
        },
        executionId: `memory_get_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      return {
        status: ToolExecutionStatus.FAILURE,
        result: null,
        error: error instanceof Error ? error.message : String(error),
        executionTime,
        output: '',
        errorOutput: error instanceof Error ? error.stack || '' : String(error),
        progress: [],
        metadata: {},
        executionId: `memory_get_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    }
  }

  isEnabled(): boolean {
    return true;
  }

  isReadOnly(_input?: Record<string, unknown>): boolean {
    return false;
  }

  isConcurrencySafe(_input?: Record<string, unknown>): boolean {
    return true;
  }

  getInfo() {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      aliases: this.aliases,
      searchTips: this.searchTips,
      enabled: this.isEnabled(),
      readOnly: this.isReadOnly(),
      destructive: false,
      concurrencySafe: this.isConcurrencySafe(),
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'cancel' as const,
    };
  }
}

export function createMemoryGetTool(memoryManager: MemoryManagerImpl): Tool {
  return new MemoryGetTool(memoryManager);
}
