/**
 * 函数工具包装器
 * 从函数签名和 JSDoc 自动提取元数据，包装为 BaseTool
 * 对标 AgentScope FunctionTool (_adapters.py)
 */

import { BaseTool } from './BaseTool';
import type {
  ToolParam,
  ToolUseContext,
  ToolCallProgress,
  ToolResult,
  ToolProgressData,
} from './types';
import { ToolTag } from './types/Tool';

/**
 * 被包装的工具函数类型
 */
export type ToolFunction<I = Record<string, unknown>, O = unknown> = (
  input: I,
  context?: ToolUseContext
) => Promise<O>;

/**
 * FunctionTool 配置
 */
export interface FunctionToolConfig<I, O> {
  /** 被包装的函数 */
  func: ToolFunction<I, O>;
  /** 工具名称（默认从函数名推断） */
  name?: string;
  /** 工具描述（默认从 JSDoc 推断） */
  description?: string;
  /** 参数 schema（默认从函数参数推断） */
  inputSchema?: ToolParam[];
  /** 工具标签 */
  tags?: ToolTag[];
  /** 是否只读 */
  isReadOnly?: boolean;
  /** 别名列表 */
  aliases?: string[];
  /** 搜索提示 */
  searchHint?: string;
}

/**
 * 函数工具包装器
 * 对标 AgentScope FunctionTool，允许将普通函数直接注册为工具
 *
 * @example
 * ```typescript
 * const searchTool = new FunctionTool({
 *   func: async (input: { query: string }) => {
 *     return searchEngine.search(input.query);
 *   },
 *   name: 'web_search',
 *   description: '搜索互联网',
 *   inputSchema: [
 *     { name: 'query', type: 'string', required: true, description: '搜索关键词' },
 *   ],
 * });
 * ```
 */
export class FunctionTool<
  I extends Record<string, unknown> = Record<string, unknown>,
  O = unknown,
> extends BaseTool<I, O> {
  readonly name: string;

  readonly description: string;

  readonly params: ToolParam[];

  override readonly aliases?: string[];

  override readonly searchHint?: string;

  override readonly tags?: ToolTag[];

  private readonly fn: ToolFunction<I, O>;

  private readonly readOnly: boolean;

  constructor(config: FunctionToolConfig<I, O>) {
    super();

    const {
      func,
      name,
      description,
      inputSchema,
      tags,
      isReadOnly,
      aliases,
      searchHint,
    } = config;

    this.name = name ?? (func.name || 'anonymous_function');
    this.description = description ?? this.extractDescription(func);
    this.params = inputSchema ?? [];
    this.fn = func;
    this.readOnly = isReadOnly ?? false;
    this.aliases = aliases;
    this.searchHint = searchHint;
    this.tags = tags;
  }

  /**
   * 执行工具调用
   */
  async execute(
    input: I,
    context?: ToolUseContext,
    _onProgress?: ToolCallProgress<ToolProgressData>
  ): Promise<ToolResult<O>> {
    const output = await this.fn(input, context);

    return {
      content: typeof output === 'string' ? output : JSON.stringify(output),
      data: output,
    } as unknown as ToolResult<O>;
  }

  /**
   * 工具是否只读
   */
  override isReadOnly(_input?: Record<string, unknown>): boolean {
    return this.readOnly;
  }

  /**
   * 提取函数描述
   * 从函数源码中提取 JSDoc 注释作为描述
   */
  private extractDescription(func: Function): string {
    const src = func.toString();
    const match = src.match(/\/\*\*([\s\S]*?)\*\//);
    if (match) {
      return match[1]
        .split('\n')
        .map((l) => l.replace(/^\s*\*/, '').trim())
        .filter(Boolean)
        .join(' ');
    }
    return '';
  }
}
