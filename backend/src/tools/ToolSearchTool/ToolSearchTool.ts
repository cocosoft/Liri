// @ts-nocheck
/**
 * 工具搜索工具
 * 用于动态发现延迟加载的工具（MCP/shouldDefer）
 * 参考CC源码 cc_code/backend/tools/ToolSearchTool/ToolSearchTool.ts 实现
 */

import { BaseTool } from '../BaseTool';
import { Tool, findToolByName } from '../types/Tool';
import { ToolUseContext } from '../types/ToolUseContext';
import { ToolResult, createToolResult } from '../types/ToolResult';
import type { ToolCallProgress } from '../types/Tool';
import { isDeferredTool, TOOL_SEARCH_TOOL_NAME } from '../utils/toolSearch';
import { getToolRegistry } from '../ToolRegistry';

/**
 * 工具搜索输入
 */
export interface ToolSearchInput {
  /**
   * 搜索查询
   * 使用 "select:<tool_name>" 进行直接选择，或使用关键词搜索
   */
  query: string;

  /**
   * 最大返回结果数（默认：5）
   */
  max_results?: number;
}

/**
 * 工具搜索输出
 */
export interface ToolSearchOutput {
  /**
   * 匹配的工具名称列表
   */
  matches: string[];

  /**
   * 原始查询
   */
  query: string;

  /**
   * 延迟工具总数
   */
  total_deferred_tools: number;
}

/**
 * 解析工具名称为可搜索部分
 * 处理MCP工具（mcp__server__action）和普通工具（CamelCase）
 */
function parseToolName(name: string): {
  parts: string[];
  full: string;
  isMcp: boolean;
} {
  // 检查是否为MCP工具
  if (name.startsWith('mcp__')) {
    const withoutPrefix = name.replace(/^mcp__/, '').toLowerCase();
    const parts = withoutPrefix.split('__').flatMap((p) => p.split('_'));
    return {
      parts: parts.filter(Boolean),
      full: withoutPrefix.replace(/__/g, ' ').replace(/_/g, ' '),
      isMcp: true,
    };
  }

  // 普通工具 - 按CamelCase和下划线分割
  const parts = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  return {
    parts,
    full: parts.join(' '),
    isMcp: false,
  };
}

/**
 * 编译搜索词为正则表达式
 */
function compileTermPatterns(terms: string[]): Map<string, RegExp> {
  const patterns = new Map<string, RegExp>();
  for (const term of terms) {
    if (!patterns.has(term)) {
      patterns.set(
        term,
        new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
      );
    }
  }
  return patterns;
}

/**
 * 基于关键词的工具搜索
 */
async function searchToolsWithKeywords(
  query: string,
  deferredTools: Tool[],
  maxResults: number
): Promise<string[]> {
  const queryLower = query.toLowerCase().trim();

  // 快速路径：如果查询与工具名称完全匹配，直接返回
  const exactMatch = deferredTools.find(
    (t) => t.name.toLowerCase() === queryLower
  );
  if (exactMatch) {
    return [exactMatch.name];
  }

  // 如果查询看起来像MCP工具前缀（mcp__server），查找匹配的工具
  if (queryLower.startsWith('mcp__') && queryLower.length > 5) {
    const prefixMatches = deferredTools
      .filter((t) => t.name.toLowerCase().startsWith(queryLower))
      .slice(0, maxResults)
      .map((t) => t.name);
    if (prefixMatches.length > 0) {
      return prefixMatches;
    }
  }

  const queryTerms = queryLower.split(/\s+/).filter((term) => term.length > 0);

  // 分区为必需（+前缀）和可选词
  const requiredTerms: string[] = [];
  const optionalTerms: string[] = [];
  for (const term of queryTerms) {
    if (term.startsWith('+') && term.length > 1) {
      requiredTerms.push(term.slice(1));
    } else {
      optionalTerms.push(term);
    }
  }

  const allScoringTerms =
    requiredTerms.length > 0
      ? [...requiredTerms, ...optionalTerms]
      : queryTerms;
  const termPatterns = compileTermPatterns(allScoringTerms);

  // 预过滤匹配所有必需词的工具
  let candidateTools = deferredTools;
  if (requiredTerms.length > 0) {
    candidateTools = deferredTools.filter((tool) => {
      const parsed = parseToolName(tool.name);
      const description = tool.description.toLowerCase();
      const hintNormalized = tool.searchHint?.toLowerCase() ?? '';

      return requiredTerms.every((term) => {
        const pattern = termPatterns.get(term);
        if (!pattern) return false;

        return (
          parsed.parts.includes(term) ||
          parsed.parts.some((part) => part.includes(term)) ||
          pattern.test(description) ||
          (hintNormalized && pattern.test(hintNormalized))
        );
      });
    });
  }

  // 评分并排序
  const scored = candidateTools.map((tool) => {
    const parsed = parseToolName(tool.name);
    const description = tool.description.toLowerCase();
    const hintNormalized = tool.searchHint?.toLowerCase() ?? '';

    let score = 0;
    for (const term of allScoringTerms) {
      const pattern = termPatterns.get(term);
      if (!pattern) continue;

      // 精确部分匹配（高权重）
      if (parsed.parts.includes(term)) {
        score += parsed.isMcp ? 12 : 10;
      } else if (parsed.parts.some((part) => part.includes(term))) {
        score += parsed.isMcp ? 6 : 5;
      }

      // 全名回退
      if (parsed.full.includes(term) && score === 0) {
        score += 3;
      }

      // searchHint匹配
      if (hintNormalized && pattern.test(hintNormalized)) {
        score += 4;
      }

      // 描述匹配
      if (pattern.test(description)) {
        score += 2;
      }
    }

    return { name: tool.name, score };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((item) => item.name);
}

/**
 * 工具搜索工具
 * 支持关键词搜索和直接选择（"select:<tool_name>"）
 */
export class ToolSearchTool extends BaseTool<ToolSearchInput, ToolSearchOutput> {
  /**
   * 工具名称
   */
  name = TOOL_SEARCH_TOOL_NAME;

  /**
   * 工具描述
   */
  description =
    '搜索延迟加载的工具。当需要使用的工具未在初始工具列表中时，使用此工具查找并加载它。';

  /**
   * 工具参数
   */
  params = [
    {
      name: 'query',
      type: 'string',
      description:
        '搜索查询。使用 "select:<tool_name>" 进行直接选择，或使用关键词搜索。',
      required: true,
    },
    {
      name: 'max_results',
      type: 'number',
      description: '最大返回结果数（默认：5）',
      required: false,
      default: 5,
    },
  ];

  /**
   * 搜索提示
   */
  searchHint = 'search for deferred tools';

  /**
   * 最大结果大小
   */
  maxResultSizeChars = 100_000;

  /**
   * 检查工具是否只读
   */
  isReadOnly(): boolean {
    return true;
  }

  /**
   * 检查工具是否并发安全
   */
  isConcurrencySafe(): boolean {
    return true;
  }

  /**
   * 执行工具搜索
   */
  async execute(
    input: ToolSearchInput,
    _context: ToolUseContext,
    _onProgress?: ToolCallProgress
  ): Promise<ToolResult<ToolSearchOutput>> {
    const { query, max_results = 5 } = input;

    // 获取所有工具
    const registry = getToolRegistry();
    const allTools = Array.from(registry.getTools().values());
    const deferredTools = allTools.filter(isDeferredTool);

    // 检查直接选择前缀
    const selectMatch = query.match(/^select:(.+)$/i);
    if (selectMatch) {
      const requested = selectMatch[1]!
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const found: string[] = [];
      for (const toolName of requested) {
        const tool = findToolByName(allTools, toolName);
        if (tool && !found.includes(tool.name)) {
          found.push(tool.name);
        }
      }

      return createToolResult(
        {
          matches: found,
          query,
          total_deferred_tools: deferredTools.length,
        },
        {
          newMessages: [
            {
              role: 'system',
              content:
                found.length > 0
                  ? `已选择工具: ${found.join(', ')}`
                  : `未找到匹配的工具: ${requested.join(', ')}`,
            },
          ],
        }
      );
    }

    // 关键词搜索
    const matches = await searchToolsWithKeywords(
      query,
      deferredTools,
      max_results
    );

    return createToolResult(
      {
        matches,
        query,
        total_deferred_tools: deferredTools.length,
      },
      {
        newMessages: [
          {
            role: 'system',
            content:
              matches.length > 0
                ? `找到 ${matches.length} 个匹配的工具: ${matches.join(', ')}`
                : '未找到匹配的工具',
          },
        ],
      }
    );
  }

  /**
   * 获取用户可见的名称
   */
  userFacingName(): string {
    return '工具搜索';
  }

  /**
   * 获取活动描述
   */
  getActivityDescription(input?: Partial<ToolSearchInput>): string | null {
    if (input?.query) {
      return `搜索工具: ${input.query}`;
    }
    return '搜索工具';
  }
}

/**
 * 创建工具搜索工具实例
 */
export function createToolSearchTool(): ToolSearchTool {
  return new ToolSearchTool();
}
