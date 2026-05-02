/**
 * 工具搜索工具函数
 * 参考CC源码 cc_code/backend/utils/toolSearch.ts 实现
 * 提供延迟工具判断、格式化等功能
 */

import type { Tool } from '../types/Tool';

/**
 * 工具搜索工具名称
 */
export const TOOL_SEARCH_TOOL_NAME = 'tool_search';

/**
 * 检查工具是否应该延迟加载
 * 参考CC源码 isDeferredTool 实现
 *
 * 延迟条件：
 * - 显式设置 shouldDefer: true
 * - MCP工具默认延迟（除非设置 alwaysLoad: true）
 * - 工具搜索工具本身不延迟
 *
 * @param tool 工具实例
 * @returns 是否应该延迟加载
 */
export function isDeferredTool(tool: Tool): boolean {
  // 显式始终加载的工具不延迟
  if (tool.alwaysLoad === true) {
    return false;
  }

  // MCP工具默认延迟
  if (tool.isMcp === true) {
    return true;
  }

  // 工具搜索工具本身不延迟
  if (tool.name === TOOL_SEARCH_TOOL_NAME) {
    return false;
  }

  // 显式设置延迟
  return tool.shouldDefer === true;
}

/**
 * 格式化延迟工具行
 * 用于在可用延迟工具列表中显示
 * 参考CC源码 formatDeferredToolLine 实现
 *
 * @param tool 工具实例
 * @returns 格式化后的工具名称
 */
export function formatDeferredToolLine(tool: Tool): string {
  return tool.name;
}

/**
 * 获取延迟工具列表
 * 从工具列表中筛选出需要延迟加载的工具
 *
 * @param tools 工具列表
 * @returns 延迟工具列表
 */
export function getDeferredTools(tools: readonly Tool[]): Tool[] {
  return tools.filter((tool) => isDeferredTool(tool));
}

/**
 * 获取非延迟工具列表
 * 从工具列表中筛选出不需要延迟加载的工具
 *
 * @param tools 工具列表
 * @returns 非延迟工具列表
 */
export function getNonDeferredTools(tools: readonly Tool[]): Tool[] {
  return tools.filter((tool) => !isDeferredTool(tool));
}

/**
 * 计算延迟工具描述字符数
 * 用于判断是否需要启用工具搜索
 *
 * @param tools 工具列表
 * @returns 延迟工具描述总字符数
 */
export function calculateDeferredToolDescriptionChars(tools: readonly Tool[]): number {
  const deferredTools = getDeferredTools(tools);

  if (deferredTools.length === 0) {
    return 0;
  }

  let totalChars = 0;

  for (const tool of deferredTools) {
    // 计算工具名称长度
    totalChars += tool.name.length;

    // 计算工具描述长度
    totalChars += tool.description.length;

    // 计算参数描述长度
    if (tool.params) {
      for (const param of tool.params) {
        totalChars += param.name.length;
        totalChars += param.description.length;
      }
    }
  }

  return totalChars;
}

/**
 * 工具搜索模式
 * 参考CC源码 ToolSearchMode 实现
 */
export type ToolSearchMode = 'tst' | 'tst-auto' | 'standard';

/**
 * 获取工具搜索模式
 * 基于环境变量 ENABLE_TOOL_SEARCH 判断
 * 参考CC源码 getToolSearchMode 实现
 *
 * @returns 工具搜索模式
 */
export function getToolSearchMode(): ToolSearchMode {
  const value = process.env.ENABLE_TOOL_SEARCH;

  // 未设置时默认启用工具搜索
  if (!value) {
    return 'tst';
  }

  const lowerValue = value.toLowerCase().trim();

  // 自动模式
  if (lowerValue === 'auto') {
    return 'tst-auto';
  }

  // 显式启用
  if (lowerValue === 'true' || lowerValue === '1') {
    return 'tst';
  }

  // 显式禁用
  if (lowerValue === 'false' || lowerValue === '0') {
    return 'standard';
  }

  // 默认启用
  return 'tst';
}

/**
 * 检查工具搜索是否启用（乐观检查）
 * 用于在不确定具体上下文时快速判断
 * 参考CC源码 isToolSearchEnabledOptimistic 实现
 *
 * @returns 是否可能启用
 */
export function isToolSearchEnabledOptimistic(): boolean {
  const mode = getToolSearchMode();
  return mode !== 'standard';
}

/**
 * 检查工具搜索工具是否可用
 * 工具列表中必须包含工具搜索工具才能使用工具搜索功能
 *
 * @param tools 工具列表
 * @returns 是否可用
 */
export function isToolSearchToolAvailable(tools: readonly { name: string }[]): boolean {
  return tools.some((tool) => tool.name === TOOL_SEARCH_TOOL_NAME);
}

/**
 * 检查模型是否支持工具引用
 * 某些模型（如haiku）不支持 tool_reference 块
 *
 * @param model 模型名称
 * @returns 是否支持
 */
export function modelSupportsToolReference(model: string): boolean {
  const normalizedModel = model.toLowerCase();

  // haiku 模型不支持 tool_reference
  if (normalizedModel.includes('haiku')) {
    return false;
  }

  // 默认假设新模型支持 tool_reference
  return true;
}

/**
 * 获取自动工具搜索的字符阈值
 * 基于模型上下文窗口的百分比计算
 *
 * @param model 模型名称
 * @returns 字符阈值
 */
export function getAutoToolSearchCharThreshold(model: string): number {
  // 默认阈值：上下文窗口的10%
  // 简化实现，实际应根据模型具体上下文窗口计算
  const DEFAULT_CONTEXT_WINDOW = 200000; // 默认200K上下文
  const DEFAULT_PERCENTAGE = 0.1; // 10%

  return Math.floor(DEFAULT_CONTEXT_WINDOW * DEFAULT_PERCENTAGE);
}

/**
 * 检查是否应该启用工具搜索
 * 综合考虑模型支持、工具列表、阈值等因素
 *
 * @param model 模型名称
 * @param tools 工具列表
 * @returns 是否启用
 */
export function shouldEnableToolSearch(model: string, tools: readonly Tool[]): boolean {
  // 检查模式
  const mode = getToolSearchMode();

  if (mode === 'standard') {
    return false;
  }

  // 检查模型支持
  if (!modelSupportsToolReference(model)) {
    return false;
  }

  // 检查工具搜索工具是否可用
  if (!isToolSearchToolAvailable(tools)) {
    return false;
  }

  // 检查是否有延迟工具
  const deferredTools = getDeferredTools(tools);

  if (deferredTools.length === 0) {
    return false;
  }

  // 自动模式：检查阈值
  if (mode === 'tst-auto') {
    const threshold = getAutoToolSearchCharThreshold(model);
    const deferredChars = calculateDeferredToolDescriptionChars(tools);

    return deferredChars >= threshold;
  }

  // 始终启用模式
  return true;
}
