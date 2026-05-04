// @ts-nocheck
/**
 * 工具结果预算控制
 * 防止工具结果过大导致上下文溢出
 */

import type { ToolResult } from '../types/ToolResult';

export interface ToolResultBudget {
  maxChars: number;
  maxTokens: number;
  enableTruncation: boolean;
}

export const DEFAULT_TOOL_RESULT_BUDGET: ToolResultBudget = {
  maxChars: 10000,
  maxTokens: 2500,
  enableTruncation: true,
};

const TOKEN_ESTIMATION_CHARS = 4;

function estimateTokens(text: string): number {
  let tokenCount = 0;
  for (const char of text) {
    if (char.charCodeAt(0) > 127) {
      tokenCount += 0.5;
    } else {
      tokenCount += 0.25;
    }
  }
  return Math.ceil(tokenCount);
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const truncated = text.substring(0, maxChars - 50);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > maxChars * 0.7) {
    return truncated.substring(0, lastSpace) + '\n... [truncated]';
  }

  return truncated + '\n... [truncated]';
}

export function applyToolResultBudget(
  result: ToolResult,
  budget: ToolResultBudget = DEFAULT_TOOL_RESULT_BUDGET
): ToolResult {
  if (typeof result.content !== 'string') {
    return result;
  }

  let content = result.content;
  let truncated = false;

  if (content.length > budget.maxChars) {
    if (budget.enableTruncation) {
      content = truncateText(content, budget.maxChars);
      truncated = true;
    }
  }

  const estimatedTokens = estimateTokens(content);
  if (estimatedTokens > budget.maxTokens) {
    if (budget.enableTruncation) {
      const targetChars = budget.maxTokens * TOKEN_ESTIMATION_CHARS;
      content = truncateText(content, targetChars);
      truncated = true;
    }
  }

  return {
    ...result,
    content,
    truncated,
  };
}

export const TOOL_RESULT_BUDGETS: Record<string, ToolResultBudget> = {
  BashTool: { maxChars: 8000, maxTokens: 2000, enableTruncation: true },
  GrepTool: { maxChars: 8000, maxTokens: 2000, enableTruncation: true },
  GlobTool: { maxChars: 5000, maxTokens: 1250, enableTruncation: true },
  FileReadTool: { maxChars: 20000, maxTokens: 5000, enableTruncation: true },
  WebFetchTool: { maxChars: 30000, maxTokens: 7500, enableTruncation: true },
  WebSearchTool: { maxChars: 10000, maxTokens: 2500, enableTruncation: true },
};

export function getToolBudget(toolName: string): ToolResultBudget {
  return TOOL_RESULT_BUDGETS[toolName] || DEFAULT_TOOL_RESULT_BUDGET;
}

export class ToolResultBudgetManager {
  private budgets: Map<string, ToolResultBudget> = new Map();
  private defaultBudget: ToolResultBudget;

  constructor(defaultBudget: ToolResultBudget = DEFAULT_TOOL_RESULT_BUDGET) {
    this.defaultBudget = defaultBudget;
  }

  setBudget(toolName: string, budget: ToolResultBudget): void {
    this.budgets.set(toolName, budget);
  }

  getBudget(toolName: string): ToolResultBudget {
    return this.budgets.get(toolName) || this.defaultBudget;
  }

  apply(result: ToolResult, toolName: string): ToolResult {
    const budget = this.getBudget(toolName);
    return applyToolResultBudget(result, budget);
  }

  applyAll(results: ToolResult[], toolNames: string[]): ToolResult[] {
    return results.map((result, index) => {
      const toolName = toolNames[index] || 'Unknown';
      return this.apply(result, toolName);
    });
  }
}

export const toolResultBudgetManager = new ToolResultBudgetManager();