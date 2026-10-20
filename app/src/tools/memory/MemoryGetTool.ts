import type { Tool } from '../types/Tool';
import { ToolResult, ToolExecutionStatus } from '../types/ToolResult';
import type { ToolUseContext } from '../types/ToolUseContext';
import { MemoryManagerImpl } from '../../memory/MemoryManager';
import { Memory } from '../../memory/types/Memory';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('memory:tools:MemoryGetTool');

export class MemoryGetTool implements Tool {
  public name: string = 'memory_get';
  public description: string = '读取已存储的记忆条目';
  public params = [
    {
      name: 'id',
      type: 'string' as const,
      description: '要检索的特定记忆 ID。省略时将列出条目。',
      required: false,
      example: 'mem_abc123',
    },
    {
      name: 'type',
      type: 'string' as const,
      description: '记忆类型过滤（conversation|fact|preference|learning）',
      required: false,
      example: 'fact',
    },
    {
      name: 'tags',
      type: 'array' as const,
      description: '用于过滤记忆的标签',
      required: false,
      example: ['important'],
    },
    {
      name: 'limit',
      type: 'number' as const,
      description: '返回结果的最大数量（默认：20）',
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
            data: null,
            error: undefined,
            executionTime,
            output: JSON.stringify({
              found: false,
              message: `Memory with id '${id}' not found`,
            }),
            errorOutput: '',
            metadata: { id, found: false },
            executionId: `memory_get_${Date.now()}`,
            toolName: this.name,
            timestamp: Date.now(),
          };
        }

        return {
          status: ToolExecutionStatus.SUCCESS,
          data: memory,
          error: undefined,
          executionTime,
          output: JSON.stringify(memory),
          errorOutput: '',
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
        data: memories,
        error: undefined,
        executionTime,
        output: JSON.stringify(memories),
        errorOutput: '',
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
        data: null,
        error: error instanceof Error ? error.message : String(error),
        executionTime,
        output: '',
        errorOutput: error instanceof Error ? error.stack || '' : String(error),
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

  /**
   * U-03（2026-10-19）：本工具只做 `getAllMemories` / 按 id 读取（纯查询，无写入）
   * ⇒ 归正为只读（原误报 false，导致只读检索被迫走完整流水线而非快速通道）。
   */
  isReadOnly(_input?: Record<string, unknown>): boolean {
    return true;
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
      // U-03（2026-10-19）：显式效果声明 —— 只读查询 ⇒ 幂等、无副作用
      idempotent: true,
      sideEffect: 'none' as const,
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'cancel' as const,
    };
  }
}

export function createMemoryGetTool(memoryManager: MemoryManagerImpl): Tool {
  return new MemoryGetTool(memoryManager);
}
