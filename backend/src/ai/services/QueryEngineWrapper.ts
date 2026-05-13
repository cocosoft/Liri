//
/**
 * QueryEngine 包装器
 * 集成 Mini Agent 到 QueryEngine
 * 实现意图预分类和智能路由
 */

import type { ChatMessage } from '../models/types.js';
import type { LLMClient } from '../clients/LLMClient.js';
import type {
  QueryParams,
  QueryResult,
} from '../interfaces/QueryInterfaces.js';
import type { ToolCall } from '@modules/tools/types';
import type { MiniAgentResult } from '../miniAgent/types.js';
import { createMiniAgent, MiniAgent } from '../miniAgent/MiniAgent.js';
import {
  QueryEngineIntegrationAdapter,
  createIntegrationAdapter,
} from '../miniAgent/QueryEngineIntegrationAdapter.js';

export interface QueryEngineWrapperConfig {
  client: LLMClient;
  defaultModel: string;
  miniAgentEnabled?: boolean;
  bypassRoutes?: string[];
  enableMetrics?: boolean;
}

export class QueryEngineWrapper {
  private client: LLMClient;
  private defaultModel: string;
  private integrationAdapter: QueryEngineIntegrationAdapter;
  private miniAgent: MiniAgent | null = null;

  constructor(config: QueryEngineWrapperConfig) {
    this.client = config.client;
    this.defaultModel = config.defaultModel;
    this.integrationAdapter = createIntegrationAdapter({
      enabled: config.miniAgentEnabled ?? false,
      bypassRoutes: config.bypassRoutes as any,
      enableMetrics: config.enableMetrics ?? false,
    });
  }

  isMiniAgentEnabled(): boolean {
    return this.integrationAdapter.isEnabled();
  }

  async query(params: QueryParams): Promise<QueryResult> {
    const { messages, maxTurns } = params;
    const input = this.extractUserInput(messages);

    if (!input) {
      return this.executeDirectQuery(params);
    }

    const miniAgentResult = await this.integrationAdapter.process(
      input,
      messages
    );

    if (!miniAgentResult.shouldContinueToQueryEngine) {
      return {
        message: {
          role: 'assistant',
          content: miniAgentResult.result?.response || '',
        },
        allMessages: messages,
        turns: 0,
        finishReason: 'mini_agent_handled' as any,
      };
    }

    return this.executeDirectQuery(params);
  }

  private extractUserInput(messages: ChatMessage[]): string {
    if (!messages || messages.length === 0) {
      return '';
    }

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role === 'user') {
      if (typeof lastMessage.content === 'string') {
        return lastMessage.content;
      }
    }

    return '';
  }

  private async executeDirectQuery(params: QueryParams): Promise<QueryResult> {
    const { messages, maxTurns, model, tools, maxTokens, temperature } = params;

    let currentMessages = [...messages];
    let accumulatedMessages = [...messages];
    let currentTurn = 0;
    const maxIterations = maxTurns || 10;

    while (currentTurn < maxIterations) {
      currentTurn++;

      try {
        const response = await this.client.chat(currentMessages, {
          model: model || this.defaultModel,
          tools,
          maxTokens,
          temperature,
        });

        const assistantMessage = this.createAssistantMessage(response);
        accumulatedMessages.push(assistantMessage);
        currentMessages.push(assistantMessage);

        if (response.tool_calls && response.tool_calls.length > 0) {
          return {
            message: assistantMessage,
            allMessages: accumulatedMessages,
            turns: currentTurn,
            finishReason: 'tool_use',
            toolCalls: response.tool_calls as unknown as ToolCall[],
          };
        }

        return {
          message: assistantMessage,
          allMessages: accumulatedMessages,
          turns: currentTurn,
          finishReason: ((response.stop_reason === 'stop'
            ? 'end_turn'
            : response.stop_reason === 'tool_calls'
              ? 'tool_use'
              : response.stop_reason) || 'end_turn') as any,
        };
      } catch (error) {
        return {
          message: null,
          allMessages: accumulatedMessages,
          turns: currentTurn,
          finishReason: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return {
      message: accumulatedMessages[accumulatedMessages.length - 1],
      allMessages: accumulatedMessages,
      turns: currentTurn,
      finishReason: 'max_turns',
    };
  }

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

  enableMiniAgent(config?: {
    bypassRoutes?: string[];
    enableMetrics?: boolean;
  }): void {
    this.integrationAdapter = createIntegrationAdapter({
      enabled: true,
      bypassRoutes: config?.bypassRoutes as any,
      enableMetrics: config?.enableMetrics ?? false,
    });
  }

  disableMiniAgent(): void {
    this.integrationAdapter = createIntegrationAdapter({
      enabled: false,
    });
  }

  getIntegrationAdapter(): QueryEngineIntegrationAdapter {
    return this.integrationAdapter;
  }

  getMetrics() {
    return this.integrationAdapter.getMetrics();
  }

  resetMetrics(): void {
    this.integrationAdapter.resetMetrics();
  }
}

export function createQueryEngineWrapper(
  config: QueryEngineWrapperConfig
): QueryEngineWrapper {
  return new QueryEngineWrapper(config);
}
