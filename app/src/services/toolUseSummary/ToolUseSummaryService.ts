/**
 * 工具使用摘要服务
 */

import type { Message } from '@modules/chat/types/message';
import { MessageRole, ContentBlockType } from '@modules/chat/types/message';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { handleError } from '@modules/error/handleError';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const logger = new Logger({ level: LogLevel.INFO });

export interface ToolInfo {
  name: string;
  input: unknown;
  output: unknown;
}

export interface GenerateToolUseSummaryParams {
  tools: ToolInfo[];
  signal: AbortSignal;
  isNonInteractiveSession: boolean;
  lastAssistantText?: string;
}

const TOOL_USE_SUMMARY_SYSTEM_PROMPT = `Write a short summary label describing what these tool calls accomplished. It appears as a single-line row in a mobile app and truncates around 30 characters, so think git-commit-subject, not sentence.

Keep the verb in past tense and the most distinctive noun. Drop articles, connectors, and long location context first.

Examples:
- Searched in auth/
- Fixed NPE in UserService
- Created signup endpoint
- Read config.json
- Ran failing tests`;

export interface ToolUseSummaryResult {
  summary: string | null;
  toolUseIds: string[];
}

export class ToolUseSummaryService {
  async generateToolUseSummary(
    params: GenerateToolUseSummaryParams
  ): Promise<string | null> {
    const { tools, signal, isNonInteractiveSession, lastAssistantText } =
      params;

    if (tools.length === 0) {
      return null;
    }

    try {
      const toolSummaries = tools
        .map((tool) => {
          const inputStr = this.truncateJson(tool.input, 300);
          const outputStr = this.truncateJson(tool.output, 300);
          return `Tool: ${tool.name}\nInput: ${inputStr}\nOutput: ${outputStr}`;
        })
        .join('\n\n');

      const contextPrefix = lastAssistantText
        ? `User's intent (from assistant's last message): ${lastAssistantText.slice(0, 200)}\n\n`
        : '';

      const response = await this.queryHaiku({
        systemPrompt: TOOL_USE_SUMMARY_SYSTEM_PROMPT,
        userPrompt: `${contextPrefix}Tools completed:\n\n${toolSummaries}\n\nLabel:`,
        signal,
        options: {
          querySource: 'tool_use_summary_generation',
          enablePromptCaching: true,
          agents: [],
          isNonInteractiveSession,
          hasAppendSystemPrompt: false,
          mcpTools: [],
        },
      });

      const summary = response.message.content
        .filter(
          (block: { type: string; text?: string }) => block.type === 'text'
        )
        .map((block: { type: string; text?: string }) =>
          block.type === 'text' ? block.text : ''
        )
        .join('')
        .trim();

      return summary || null;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await handleError(error, {
        module: 'services:toolUseSummary',
        action: 'generate_summary',
      });
      return null;
    }
  }

  private async queryHaiku(params: {
    systemPrompt: string;
    userPrompt: string;
    signal: AbortSignal;
    options: {
      querySource: string;
      enablePromptCaching: boolean;
      agents: unknown[];
      isNonInteractiveSession: boolean;
      hasAppendSystemPrompt: boolean;
      mcpTools: unknown[];
    };
  }): Promise<{ message: { content: Array<{ type: string; text: string }> } }> {
    throw new AppError(
      'queryHaiku not implemented - requires API integration',
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }

  private truncateJson(value: unknown, maxLength: number): string {
    try {
      const str = JSON.stringify(value);
      if (str.length <= maxLength) {
        return str;
      }
      return str.slice(0, maxLength - 3) + '...';
    } catch {
      return '[unable to serialize]';
    }
  }

  createToolUseSummaryMessage(summary: string, toolUseIds: string[]): Message {
    return {
      id: `tool_use_summary_${Date.now()}`,
      role: MessageRole.USER,
      content: [
        {
          type: ContentBlockType.TEXT,
          value: summary,
        },
      ],
      toolUseIds,
      isMeta: true,
    } as unknown as Message;
  }
}

let toolUseSummaryServiceInstance: ToolUseSummaryService | null = null;

export function getToolUseSummaryService(): ToolUseSummaryService {
  if (!toolUseSummaryServiceInstance) {
    toolUseSummaryServiceInstance = new ToolUseSummaryService();
  }
  return toolUseSummaryServiceInstance;
}

export function createToolUseSummaryMessage(
  summary: string,
  toolUseIds: string[]
): Message {
  const service = getToolUseSummaryService();
  return service.createToolUseSummaryMessage(summary, toolUseIds);
}
