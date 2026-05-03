// @ts-nocheck
/**
 * AI 查询引擎
 * 核心查询逻辑，与工具执行器解耦
 */

import type { ChatMessage } from '@modules/ai/models/types';
import type { LLMClient } from '@modules/ai/clients/LLMClient';
import type { IToolExecutor } from '@modules/ai/interfaces/ToolExecutor';
import type { QueryParams, QueryResult, ToolContext } from '@modules/ai/interfaces/QueryInterfaces';
import { ModuleError } from '@modules/errors';

export interface AIQueryEngineConfig {
  /**
   * 默认 LLM 客户端
   */
  client: LLMClient;
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
          const toolResults = await this.executeTools(response.tool_calls, params.toolContext);

          const toolResultMessages = this.createToolResultMessages(response.tool_calls, toolResults);
          accumulatedMessages.push(...toolResultMessages);
          currentMessages.push(...toolResultMessages);

          continue;
        }

        return {
          message: response,
          allMessages: accumulatedMessages,
          turns: this.currentTurn,
          finishReason: response.stop_reason || 'end_turn',
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

      const fullResponse: any = {
        content: [],
        tool_calls: [],
      };

      try {
        for await (const event of this.config.client.stream(currentMessages, {
          model: params.model || this.config.defaultModel,
          tools: params.tools,
        })) {
          if (event.type === 'content_block_delta') {
            fullResponse.content.push(event.delta);
          } else if (event.type === 'tool_call') {
            fullResponse.tool_calls.push(event.tool_call);
          }
        }

        const assistantMessage = this.createAssistantMessage(fullResponse);
        accumulatedMessages.push(assistantMessage);
        currentMessages.push(assistantMessage);

        if (fullResponse.tool_calls && fullResponse.tool_calls.length > 0) {
          const toolResults = await this.executeTools(fullResponse.tool_calls, params.toolContext);

          const toolResultMessages = this.createToolResultMessages(fullResponse.tool_calls, toolResults);
          accumulatedMessages.push(...toolResultMessages);
          currentMessages.push(...toolResultMessages);

          yield {
            message: assistantMessage,
            allMessages: accumulatedMessages,
            turns: this.currentTurn,
            finishReason: 'tool_use',
            toolCalls: fullResponse.tool_calls,
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
  private async executeTools(toolCalls: any[], context: ToolContext | undefined): Promise<any[]> {
    const results = [];

    for (const toolCall of toolCalls) {
      try {
        const result = await this.config.toolExecutor.executeTool(
          {
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.input,
          },
          context || {}
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
  private createAssistantMessage(response: any): ChatMessage {
    const message: ChatMessage = {
      role: 'assistant',
      content: '',
    };

    if (typeof response.content === 'string') {
      message.content = response.content;
    } else if (Array.isArray(response.content)) {
      message.content = response.content
        .map((block: any) => {
          if (block.type === 'text') return block.text;
          if (block.type === 'thinking') return block.thinking;
          return JSON.stringify(block);
        })
        .join('\n');
    }

    if (response.tool_calls) {
      message.tool_calls = response.tool_calls.map((tc: any) => ({
        id: tc.id,
        name: tc.name,
        input: tc.input,
      }));
    }

    return message;
  }

  /**
   * 创建工具结果消息
   */
  private createToolResultMessages(toolCalls: any[], toolResults: any[]): ChatMessage[] {
    const messages: ChatMessage[] = [];

    for (let i = 0; i < toolCalls.length; i++) {
      const toolCall = toolCalls[i];
      const result = toolResults[i];

      messages.push({
        role: 'user',
        content: '',
        tool_result: {
          tool_call_id: toolCall.id,
          content: typeof result.content === 'string'
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