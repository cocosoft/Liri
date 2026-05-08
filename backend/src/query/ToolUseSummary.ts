/**
 * 工具调用摘要服务（参考CC源码 cc_code/backend/services/toolUseSummary/）
 * 在Token预算紧张时自动生成工具调用结果的摘要
 */

import type { ToolCall, ToolResult } from '../chat/types/tool.js';

export interface ToolUseSummaryConfig {
  maxSummaryLength?: number;
  enableAutoSummary?: boolean;
  summaryThresholdTokens?: number;
}

export interface ToolUseSummary {
  toolCallId: string;
  toolName: string;
  summary: string;
  originalLength: number;
  summaryLength: number;
  timestamp: number;
}

export interface ToolUseSummarizer {
  summarize(toolCall: ToolCall, toolResult: ToolResult): ToolUseSummary;
  summarizeBatch(toolCalls: ToolCall[], toolResults: ToolResult[]): ToolUseSummary[];
  shouldSummarize(result: ToolResult): boolean;
}

export class ToolUseSummarizerImpl implements ToolUseSummarizer {
  private config: ToolUseSummaryConfig;

  constructor(config: ToolUseSummaryConfig = {}) {
    this.config = {
      maxSummaryLength: config.maxSummaryLength || 500,
      enableAutoSummary: config.enableAutoSummary !== undefined ? config.enableAutoSummary : true,
      summaryThresholdTokens: config.summaryThresholdTokens || 2000,
    };
  }

  summarize(toolCall: ToolCall, toolResult: ToolResult): ToolUseSummary {
    const resultContent = typeof toolResult.result === 'string' 
      ? toolResult.result 
      : JSON.stringify(toolResult.result);

    const originalLength = resultContent.length;
    let summary = this.generateSummary(resultContent, toolCall.name);

    return {
      toolCallId: toolResult.toolCallId,
      toolName: toolCall.name,
      summary,
      originalLength,
      summaryLength: summary.length,
      timestamp: Date.now(),
    };
  }

  summarizeBatch(toolCalls: ToolCall[], toolResults: ToolResult[]): ToolUseSummary[] {
    const summaries: ToolUseSummary[] = [];
    
    for (let i = 0; i < toolCalls.length; i++) {
      const toolCall = toolCalls[i];
      const toolResult = toolResults.find(r => r.toolCallId === toolCall.id);
      
      if (toolResult && this.shouldSummarize(toolResult)) {
        summaries.push(this.summarize(toolCall, toolResult));
      }
    }
    
    return summaries;
  }

  shouldSummarize(result: ToolResult): boolean {
    if (!this.config.enableAutoSummary) {
      return false;
    }

    const resultContent = typeof result.result === 'string' 
      ? result.result 
      : JSON.stringify(result.result);

    return resultContent.length > (this.config.summaryThresholdTokens ?? 0);
  }

  private generateSummary(content: string, toolName: string): string {
    const maxLength = this.config.maxSummaryLength || 500;
    
    if (content.length <= maxLength) {
      return content;
    }

    const lines = content.split('\n');
    let summary = `[工具调用结果摘要 - ${toolName}]\n\n`;
    
    // 提取关键信息
    const keySections = [
      { regex: /^(Error|Exception|Fail)/i, label: '错误信息' },
      { regex: /^(Success|Done|Completed)/i, label: '成功信息' },
      { regex: /^(File|Path|Directory)/i, label: '文件路径' },
      { regex: /^(Result|Output|Return)/i, label: '返回结果' },
    ];

    for (const section of keySections) {
      const matchedLine = lines.find(line => section.regex.test(line));
      if (matchedLine) {
        summary += `**${section.label}**: ${matchedLine.substring(0, 200)}\n`;
      }
    }

    // 如果没有找到结构化信息，使用前几行
    if (summary.length < 50) {
      summary += `**内容预览**: ${content.substring(0, maxLength - summary.length - 3)}...`;
    } else if (summary.length > maxLength) {
      summary = summary.substring(0, maxLength - 3) + '...';
    }

    return summary;
  }
}

export function createToolUseSummarizer(config?: ToolUseSummaryConfig): ToolUseSummarizer {
  return new ToolUseSummarizerImpl(config);
}