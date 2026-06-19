/**
 * TAOR (Think-Act-Observe-Repeat) 循环核心
 */

import type { ToolCall, ToolResult } from '@modules/core';
import type { AIProvider } from '@modules/ai';
import type { ChatOptions } from '@modules/ai';
import type {
  ChatMessage,
  ToolDefinition,
  ParsedToolCall,
} from '@modules/ai';

interface TAORLoopConfig {
  systemPrompt?: string;
  maxTurns?: number;
  model?: string;
}

interface ToolRegistry {
  getSchemas(): ToolDefinition[];
  execute(toolCall: ToolCall, context: unknown): Promise<ToolResult>;
}

interface ResolvedConfig {
  systemPrompt: string;
  maxTurns: number;
  model: string;
}

export class TAORLoop {
  private config: ResolvedConfig;
  private toolRegistry: ToolRegistry;
  private llmClient: AIProvider;
  private turnCount: number = 0;

  constructor(
    config: TAORLoopConfig,
    toolRegistry: ToolRegistry,
    llmClient: AIProvider
  ) {
    this.config = {
      systemPrompt: config.systemPrompt || 'You are a helpful AI assistant.',
      maxTurns: config.maxTurns || 50,
      model: config.model || '',
    };
    this.toolRegistry = toolRegistry;
    this.llmClient = llmClient;
  }

  /**
   * 运行 TAOR 循环
   */
  async run(initialMessage: string): Promise<string> {
    let messages: ChatMessage[] = [];

    if (this.config.systemPrompt) {
      messages.push({
        role: 'system',
        content: this.config.systemPrompt,
      });
    }

    messages.push({
      role: 'user',
      content: initialMessage,
    });

    while (this.turnCount < this.config.maxTurns) {
      this.turnCount++;

      const response = await this.llmClient.chat(messages, {
        tools: this.toolRegistry.getSchemas(),
        model: this.config.model,
      });

      const toolCalls = response.tool_calls?.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments:
            typeof tc.arguments === 'string'
              ? tc.arguments
              : JSON.stringify(tc.arguments),
        },
      }));

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: response.content,
        tool_calls: toolCalls,
      };

      messages.push(assistantMessage);

      if (response.stop_reason === 'stop') {
        return response.content;
      }

      if (response.stop_reason === 'tool_calls' && response.tool_calls) {
        for (const toolCall of response.tool_calls) {
          const result = await this.toolRegistry.execute(
            {
              id: toolCall.id,
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
            {}
          );

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        }
      }
    }

    return 'Max turns reached';
  }

  /**
   * 重置循环状态
   */
  reset(): void {
    this.turnCount = 0;
  }
}
