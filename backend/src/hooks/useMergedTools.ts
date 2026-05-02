/**
 * 工具列表合并Hook
 * 基于CC源码 cc_code/backend/hooks/useMergedTools.ts 实现
 * 
 * 合并来源：
 * - 内置工具（Built-in Tools）
 * - MCP工具（MCP Tools）
 * - 插件工具（Plugin Tools）
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { getToolRegistry, type Tool } from '@modules/tools';
import { hookManager } from './HookManager';

/**
 * 工具来源类型
 */
export type ToolSource = 'builtin' | 'mcp' | 'plugin';

/**
 * 合并后的工具信息
 */
export interface MergedTool extends Tool {
  /** 工具来源 */
  source: ToolSource;
  /** 是否存在名称冲突 */
  hasConflict: boolean;
  /** 冲突的工具列表 */
  conflicts?: MergedTool[];
}

/**
 * useMergedTools Hook结果
 */
export interface UseMergedToolsResult {
  /** 所有合并后的工具 */
  tools: MergedTool[];
  /** 按来源分组的工具 */
  toolsBySource: {
    builtin: MergedTool[];
    mcp: MergedTool[];
    plugin: MergedTool[];
  };
  /** 有冲突的工具 */
  conflictingTools: MergedTool[];
  /** 是否正在加载 */
  isLoading: boolean;
  /** 刷新工具列表 */
  refresh: () => void;
}

/**
 * 判断工具来源
 */
function getToolSource(tool: Tool): ToolSource {
  if (tool.isMcp) return 'mcp';
  if (tool.isLsp) return 'builtin';
  
  // 检查是否为插件工具
  const toolName = tool.name.toLowerCase();
  if (toolName.includes('plugin') || toolName.includes('extension')) {
    return 'plugin';
  }
  
  return 'builtin';
}

/**
 * 合并工具列表并处理冲突
 */
function mergeTools(allTools: Tool[]): MergedTool[] {
  // 按名称分组
  const toolsByName = new Map<string, Tool[]>();
  for (const tool of allTools) {
    const name = tool.name.toLowerCase();
    if (!toolsByName.has(name)) {
      toolsByName.set(name, []);
    }
    toolsByName.get(name)!.push(tool);
  }

  const merged: MergedTool[] = [];

  for (const [name, tools] of toolsByName) {
    for (const tool of tools) {
      const source = getToolSource(tool);
      const conflicts = tools
        .filter(t => t !== tool)
        .map(t => ({
          ...t,
          source: getToolSource(t),
          hasConflict: true,
        }));

      merged.push({
        ...tool,
        source,
        hasConflict: conflicts.length > 0,
        conflicts: conflicts.length > 0 ? conflicts : undefined,
      });
    }
  }

  return merged;
}

/**
 * useMergedTools Hook
 * @returns 合并后的工具列表
 */
export function useMergedTools(): UseMergedToolsResult {
  const [tools, setTools] = useState<Tool[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // 加载工具列表
  const loadTools = useCallback(async () => {
    setIsLoading(true);
    try {
      const registry = getToolRegistry();
      const allTools = Array.from(registry.getTools().values());
      setTools(allTools);
    } catch (error) {
      console.error('加载工具列表失败:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 初始化加载
  useEffect(() => {
    loadTools();

    // 订阅工具变更事件
    const unsubscribe = hookManager.subscribe('tool.registered', loadTools);

    return () => {
      unsubscribe();
    };
  }, [loadTools]);

  // 合并工具
  const mergedTools = useMemo(() => mergeTools(tools), [tools]);

  // 按来源分组
  const toolsBySource = useMemo(() => {
    const grouped = {
      builtin: [] as MergedTool[],
      mcp: [] as MergedTool[],
      plugin: [] as MergedTool[],
    };

    for (const tool of mergedTools) {
      grouped[tool.source].push(tool);
    }

    return grouped;
  }, [mergedTools]);

  // 获取有冲突的工具
  const conflictingTools = useMemo(() => {
    return mergedTools.filter(tool => tool.hasConflict);
  }, [mergedTools]);

  return {
    tools: mergedTools,
    toolsBySource,
    conflictingTools,
    isLoading,
    refresh: loadTools,
  };
}

/**
 * useMergedTools 的简化版本，仅返回工具列表
 */
export function useTools(): Tool[] {
  const { tools } = useMergedTools();
  return tools;
}

/**
 * 按名称获取工具
 */
export function useToolByName(name: string): MergedTool | undefined {
  const { tools } = useMergedTools();
  return tools.find(tool => tool.name.toLowerCase() === name.toLowerCase());
}