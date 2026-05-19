//
/**
 * AI 查询引擎
 * 核心查询逻辑，与工具执行器解耦
 */

import type {
  ChatMessage,
  ChatResponse,
  ParsedToolCall,
} from '@modules/ai/models/types';
import type { AIProvider } from '@modules/ai/providers';
import type { ChatOptions } from '@modules/ai/providers';
import type { IToolExecutor } from '@modules/ai/interfaces/ToolExecutor';
import type {
  QueryParams,
  QueryResult,
  ToolContext,
} from '@modules/ai/interfaces/QueryInterfaces';
import { ModuleError } from '@modules/errors';

export interface AIQueryEngineConfig {
  /**
   * 默认 LLM 客户端
   */
  client: AIProvider;
  /**
   * 工具执行器
   */
  toolExecutor: IToolExecutor;
  /**
   * 默认模型
   */
  defaultModel: string;
  /**
   * 最大查询轮次
   */
  maxTurns?: number;
  /**
   * 是否启用流式输出
   */
  stream?: boolean;
}

export class AIQueryEngine {
  private config: AIQueryEngineConfig;
  private currentTurn: number = 0;

  constructor(config: AIQueryEngineConfig) {
    this.config = {
      maxTurns: 10,
      stream: false,
      ...config,
    };
  }

  /**
   * 映射stop_reason到QueryResult的finishReason
   */
  private mapStopReason(
    reason: string
  ):
    | 'end_turn'
    | 'stop_sequence'
    | 'max_tokens'
    | 'max_turns'
    | 'tool_use'
    | 'error' {
    switch (reason) {
      case 'stop':
        return 'end_turn';
      case 'tool_calls':
        return 'tool_use';
      case 'max_tokens':
        return 'max_tokens';
      default:
        return 'end_turn';
    }
  }

  /**
   * 执行查询
   */
  async query(params: QueryParams): Promise<QueryResult> {
    const { messages, maxTurns } = params;
    const maxIterations = maxTurns || this.config.maxTurns || 10;
    this.currentTurn = 0;

    let currentMessages = [...messages];
    let accumulatedMessages = [...messages];

    while (this.currentTurn < maxIterations) {
      this.currentTurn++;

      try {
        const response = await this.config.client.chat(currentMessages, {
          model: params.model || this.config.defaultModel,
          tools: params.tools,
          maxTokens: params.maxTokens,
          temperature: params.temperature,
        });

        const assistantMessage = this.createAssistantMessage(response);
        accumulatedMessages.push(assistantMessage);
        currentMessages.push(assistantMessage);

        if (response.tool_calls && response.tool_calls.length > 0) {
          const toolResults = await this.executeTools(
            response.tool_calls,
            params.toolContext
          );

          const toolResultMessages = this.createToolResultMessages(
            response.tool_calls,
            toolResults
          );
          accumulatedMessages.push(...toolResultMessages);
          currentMessages.push(...toolResultMessages);

          continue;
        }

        return {
          message: response,
          allMessages: accumulatedMessages,
          turns: this.currentTurn,
          finishReason: this.mapStopReason(response.stop_reason),
        };
      } catch (error) {
        return {
          message: null,
          allMessages: accumulatedMessages,
          turns: this.currentTurn,
          finishReason: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return {
      message: accumulatedMessages[accumulatedMessages.length - 1],
      allMessages: accumulatedMessages,
      turns: this.currentTurn,
      finishReason: 'max_turns',
    };
  }

  /**
   * 执行流式查询
   */
  async *streamQuery(params: QueryParams): AsyncGenerator<QueryResult> {
    const { messages } = params;
    this.currentTurn = 0;

    let currentMessages = [...messages];
    let accumulatedMessages = [...messages];

    while (this.currentTurn < (params.maxTurns || this.config.maxTurns || 10)) {
      this.currentTurn++;

      let fullContent = '';
      const rawToolCalls: Array<{ id: string; name: string; input?: unknown }> =
        [];

      try {
        for await (const event of (
          this.config.client as unknown as { stream: Function }
        ).stream(currentMessages, {
          model: params.model || this.config.defaultModel,
          tools: params.tools,
        })) {
          if (event.type === 'content_block_delta') {
            fullContent += event.delta;
          } else if (event.type === 'tool_call') {
            rawToolCalls.push(event.tool_call);
          }
        }

        const toolCalls: ParsedToolCall[] | undefined =
          rawToolCalls.length > 0
            ? rawToolCalls.map((tc) => ({
                id: tc.id,
                name: tc.name,
                arguments: (tc.input as Record<string, unknown>) || {},
              }))
            : undefined;

        const response: ChatResponse = {
          content: fullContent,
          stop_reason: toolCalls ? 'tool_calls' : 'stop',
          tool_calls: toolCalls,
        };

        const assistantMessage = this.createAssistantMessage(response);
        accumulatedMessages.push(assistantMessage);
        currentMessages.push(assistantMessage);

        if (response.tool_calls && response.tool_calls.length > 0) {
          const toolResults = await this.executeTools(
            response.tool_calls,
            params.toolContext
          );

          const toolResultMessages = this.createToolResultMessages(
            response.tool_calls,
            toolResults
          );
          accumulatedMessages.push(...toolResultMessages);
          currentMessages.push(...toolResultMessages);

          yield {
            message: assistantMessage,
            allMessages: accumulatedMessages,
            turns: this.currentTurn,
            finishReason: 'tool_use',
            toolCalls: response.tool_calls.map((tc) => ({
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            })),
          };

          continue;
        }

        yield {
          message: assistantMessage,
          allMessages: accumulatedMessages,
          turns: this.currentTurn,
          finishReason: 'end_turn',
        };

        return;
      } catch (error) {
        yield {
          message: null,
          allMessages: accumulatedMessages,
          turns: this.currentTurn,
          finishReason: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
        return;
      }
    }

    yield {
      message: accumulatedMessages[accumulatedMessages.length - 1],
      allMessages: accumulatedMessages,
      turns: this.currentTurn,
      finishReason: 'max_turns',
    };
  }

  /**
   * 执行工具调用
   */
  private async executeTools(
    toolCalls: unknown[],
    context: ToolContext | undefined
  ): Promise<unknown[]> {
    const results = [];

    for (const raw of toolCalls) {
      const toolCall = raw as { id: string; name: string; input: unknown };
      try {
        const result = await this.config.toolExecutor.executeTool(
          {
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.input as Record<string, unknown>,
          },
          (context || {}) as Record<string, unknown>
        );
        results.push(result);
      } catch (error) {
        results.push({
          id: toolCall.id,
          result: undefined,
          content: error instanceof Error ? error.message : String(error),
          error: true,
        });
      }
    }

    return results;
  }

  /**
   * 创建助手消息
   */
  private createAssistantMessage(response: ChatResponse): ChatMessage {
    const message: ChatMessage = {
      role: 'assistant',
      content: '',
    };

    if (typeof response.content === 'string') {
      message.content = response.content;
    }

    if (response.tool_calls) {
      message.tool_calls = response.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      }));
    }

    return message;
  }

  /**
   * 创建工具结果消息
   */
  private createToolResultMessages(
    toolCalls: unknown[],
    toolResults: unknown[]
  ): ChatMessage[] {
    const messages: ChatMessage[] = [];

    for (let i = 0; i < toolCalls.length; i++) {
      const toolCall = toolCalls[i] as { id: string };
      const result = toolResults[i] as {
        content: string;
        error?: boolean;
      };

      messages.push({
        role: 'user',
        content: '',
        tool_result: {
          tool_call_id: toolCall.id,
          content:
            typeof result.content === 'string'
              ? result.content
              : JSON.stringify(result.content),
          is_error: result.error || false,
        },
      });
    }

    return messages;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<AIQueryEngineConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前轮次
   */
  getCurrentTurn(): number {
    return this.currentTurn;
  }
}

export default AIQueryEngine;
