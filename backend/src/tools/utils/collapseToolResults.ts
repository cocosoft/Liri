/**
 * 工具搜索/读取结果折叠工具
 *
 * 参考CC源码 cc_code/backend/utils/collapseReadSearch.ts 实现
 * 检测连续的搜索/读取工具调用，将其折叠为摘要形式展现。
 * 提供按工具名和输入判断折叠逻辑的基础工具。
 */

import type { Tool } from '../types/Tool';

/**
 * 搜索/读取检测结果
 */
export interface SearchOrReadResult {
  isCollapsible: boolean;
  isSearch: boolean;
  isRead: boolean;
  isList: boolean;
}

/**
 * 折叠组信息
 */
export interface CollapsedToolGroupInfo {
  searchCount: number;
  readCount: number;
  listCount: number;
  totalCount: number;
  toolNames: string[];
  summaryText: string;
}

/**
 * 工具结果组（含具体结果数据，用于分组显示）
 */
export interface ToolResultGroupItem {
  toolName: string;
  toolInput: unknown;
  toolOutput: unknown;
  isSearch: boolean;
  isRead: boolean;
  isList: boolean;
}

/**
 * 分组显示结果
 */
export interface GroupedDisplayResult {
  items: ToolResultGroupItem[];
  summary: CollapsedToolGroupInfo;
  formattedOutput: string;
}

/**
 * 提取工具输入的搜索/读取信息
 *
 * @param toolName 工具名称
 * @param toolInput 工具输入
 * @param tools 可用工具列表
 * @returns 搜索/读取检测结果
 */
export function getToolSearchOrReadInfo(
  toolName: string,
  toolInput: unknown,
  tools: readonly Tool[]
): SearchOrReadResult {
  const tool = tools.find(
    (t) => t.name === toolName || (t.aliases && t.aliases.includes(toolName))
  );

  if (!tool?.isSearchOrReadCommand) {
    return {
      isCollapsible: false,
      isSearch: false,
      isRead: false,
      isList: false,
    };
  }

  const result = tool.isSearchOrReadCommand(
    toolInput as Record<string, unknown>
  );
  const isList = result.isList ?? false;
  const isCollapsible = result.isSearch || result.isRead || isList;

  return {
    isCollapsible,
    isSearch: result.isSearch,
    isRead: result.isRead,
    isList,
  };
}

/**
 * 判断工具调用列表中的连续搜索/读取操作，生成折叠组信息。
 * 非搜索/读取的工具调用会中断当前组。
 *
 * @param toolCalls 工具调用列表（按顺序排列）
 * @param tools 可用工具列表
 * @returns 折叠组信息列表
 */
export function collapseToolCalls(
  toolCalls: Array<{ name: string; input: unknown }>,
  tools: readonly Tool[]
): CollapsedToolGroupInfo[] {
  const groups: CollapsedToolGroupInfo[] = [];
  let currentGroup: CollapsedToolGroupInfo | null = null;

  for (const call of toolCalls) {
    const info = getToolSearchOrReadInfo(call.name, call.input, tools);

    if (info.isCollapsible) {
      if (!currentGroup) {
        currentGroup = {
          searchCount: 0,
          readCount: 0,
          listCount: 0,
          totalCount: 0,
          toolNames: [],
          summaryText: '',
        };
      }

      if (info.isSearch) currentGroup.searchCount++;
      if (info.isRead) currentGroup.readCount++;
      if (info.isList) currentGroup.listCount++;
      currentGroup.totalCount++;

      if (!currentGroup.toolNames.includes(call.name)) {
        currentGroup.toolNames.push(call.name);
      }
    } else {
      if (currentGroup) {
        currentGroup.summaryText = buildGroupSummary(currentGroup);
        groups.push(currentGroup);
        currentGroup = null;
      }
    }
  }

  if (currentGroup) {
    currentGroup.summaryText = buildGroupSummary(currentGroup);
    groups.push(currentGroup);
  }

  return groups;
}

/**
 * 构建折叠组摘要文本
 *
 * @param group 折叠组信息
 * @returns 摘要文本
 */
export function buildGroupSummary(group: CollapsedToolGroupInfo): string {
  const parts: string[] = [];

  if (group.searchCount > 0) {
    parts.push(`搜索 ${group.searchCount} 次`);
  }
  if (group.readCount > 0) {
    parts.push(`读取 ${group.readCount} 个`);
  }
  if (group.listCount > 0) {
    parts.push(`列出 ${group.listCount} 次`);
  }

  const toolList = group.toolNames.join(', ');
  return `🔍 ${parts.join(' · ')} (使用 ${toolList})`;
}

/**
 * 将工具结果按连续搜索/读取操作分组，生成可直接显示的组列表。
 * 每个组包含：组内成员列表（含输入输出）+ 统计摘要 + 格式化输出文本。
 * 非搜索/读取的结果单独返回（不分组）。
 *
 * @param toolResults 工具结果列表（按执行顺序排列）
 * @param tools 可用工具列表
 * @returns 分组显示结果列表（搜索/读取结果会被分组，其他结果被展平）
 */
export function groupToolResults(
  toolResults: Array<{
    toolName: string;
    toolInput: unknown;
    toolOutput: unknown;
  }>,
  tools: readonly Tool[]
): Array<GroupedDisplayResult | ToolResultGroupItem> {
  const groups: Array<GroupedDisplayResult | ToolResultGroupItem> = [];
  let currentItems: ToolResultGroupItem[] = [];
  let currentGroup: CollapsedToolGroupInfo | null = null;

  function flushGroup(): void {
    if (currentItems.length > 0 && currentGroup) {
      currentGroup.summaryText = buildGroupSummary(currentGroup);
      const formattedOutput = currentItems
        .map((item) => {
          const prefix = item.isSearch
            ? '[搜索]'
            : item.isRead
              ? '[读取]'
              : '[列出]';
          return `${prefix} ${item.toolName}: ${JSON.stringify(item.toolOutput)?.slice(0, 200)}`;
        })
        .join('\n');

      groups.push({
        items: currentItems,
        summary: currentGroup,
        formattedOutput,
      });
      currentItems = [];
      currentGroup = null;
    }
  }

  for (const result of toolResults) {
    const info = getToolSearchOrReadInfo(
      result.toolName,
      result.toolInput,
      tools
    );

    if (info.isCollapsible) {
      if (!currentGroup) {
        currentGroup = {
          searchCount: 0,
          readCount: 0,
          listCount: 0,
          totalCount: 0,
          toolNames: [],
          summaryText: '',
        };
      }

      if (info.isSearch) currentGroup.searchCount++;
      if (info.isRead) currentGroup.readCount++;
      if (info.isList) currentGroup.listCount++;
      currentGroup.totalCount++;

      if (!currentGroup.toolNames.includes(result.toolName)) {
        currentGroup.toolNames.push(result.toolName);
      }

      currentItems.push({
        toolName: result.toolName,
        toolInput: result.toolInput,
        toolOutput: result.toolOutput,
        isSearch: info.isSearch,
        isRead: info.isRead,
        isList: info.isList,
      });
    } else {
      flushGroup();
      groups.push({
        toolName: result.toolName,
        toolInput: result.toolInput,
        toolOutput: result.toolOutput,
        isSearch: false,
        isRead: false,
        isList: false,
      });
    }
  }

  flushGroup();

  return groups;
}

/**
 * 获取分组结果的显示文本
 * 分组结果显示为折叠摘要行，非分组结果保持原样。
 *
 * @param items 分组结果列表
 * @returns 显示文本行数组
 */
export function formatGroupedForDisplay(
  items: Array<GroupedDisplayResult | ToolResultGroupItem>
): string[] {
  const lines: string[] = [];

  for (const item of items) {
    if ('summary' in item && 'formattedOutput' in item) {
      lines.push(item.summary.summaryText);
    } else {
      const single = item as ToolResultGroupItem;
      lines.push(
        `[${single.toolName}]: ${JSON.stringify(single.toolOutput)?.slice(0, 200)}`
      );
    }
  }

  return lines;
}
