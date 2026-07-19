/**
 * QueryEngine 包装器
 * 集成 Mini Agent 到 QueryEngine
 * 实现意图预分类和智能路由
 *
 * 注意: 废弃的 AIQueryEngine 已删除（v7.0+），统一走此包装器。
 *
 * TODO(未来): 将 executeDirectQuery 替换为 query/QueryEngine 委托调用
 *   1. 注入 ChatManagerImpl 依赖或通过工厂获取
 *   2. 使用 createQueryEngine(chatManager, config) 创建主引擎
 *   3. 将 messages 转换为 prompt string 后委托 QueryEngine.query()
 *   4. 将 AsyncGenerator 输出转换为 Promise<QueryResult>
 */

import type { ChatMessage } from '../models/types.js';
import type { AIProvider } from '../providers/AIProvider.js';
import type {
  QueryParams,
  QueryResult,
  StreamEvent,
} from '../interfaces/QueryInterfaces.js';
import type {
  IQueryEngineCore,
  QueryOptions,
} from '../interfaces/IQueryEngineCore.js';
import type { ToolCall } from '@modules/tools/types';
import { createLocalAgent, LocalAgent } from '../localAgent/LocalAgent.js';
import {
  QueryEngineIntegrationAdapter,
  createIntegrationAdapter,
} from '../localAgent/QueryEngineIntegrationAdapter.js';
import { SmartRouter } from '../router/SmartRouter.js';
import { RouteKey } from '../router/routes.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'ai:services:QueryEngineWrapper',
  level: LogLevel.INFO,
});

export interface QueryEngineWrapperConfig {
  client: AIProvider;
  defaultModel: string;
  localAgentEnabled?: boolean;
  bypassRoutes?: string[];
  enableMetrics?: boolean;
}

export class QueryEngineWrapper implements IQueryEngineCore {
  private client: AIProvider;
  private defaultModel: string;
  private integrationAdapter: QueryEngineIntegrationAdapter;
  private localAgent: LocalAgent | null = null;
  private abortController: AbortController | null = null;
  private smartRouter: SmartRouter | null = null;

  constructor(config: QueryEngineWrapperConfig) {
    this.client = config.client;
    this.defaultModel = config.defaultModel;
    this.integrationAdapter = createIntegrationAdapter({
      enabled: config.localAgentEnabled ?? false,
      bypassRoutes: config.bypassRoutes as any,
      enableMetrics: config.enableMetrics ?? false,
    });
  }

  isLocalAgentEnabled(): boolean {
    return this.integrationAdapter.isEnabled();
  }

  /**
   * 设置 SmartRouter 实例（启用智能路由决策）
   */
  setSmartRouter(router: SmartRouter): void {
    this.smartRouter = router;
  }

  /**
   * 移除 SmartRouter（回退到原有 LocalAgent 预分类或直通）
   */
  removeSmartRouter(): void {
    this.smartRouter = null;
  }

  /**
   * 获取 SmartRouter 实例（用于前端读取路由状态）
   */
  getSmartRouter(): SmartRouter | null {
    return this.smartRouter;
  }

  async query(
    messages: ChatMessage[],
    options?: QueryOptions
  ): Promise<QueryResult> {
    const params = this.buildQueryParams(messages, options);
    return this.executeWithLocalAgent(params);
  }

  async *streamQuery(
    messages: ChatMessage[],
    options?: QueryOptions
  ): AsyncIterable<StreamEvent> {
    this.abortController = new AbortController();
    const params = this.buildQueryParams(messages, options);

    const input = this.extractUserInput(messages);
    let modelOverride = '';

    if (input) {
      // SmartRouter 决策（优先于 LocalAgent 预分类）
      if (this.smartRouter?.isEnabled()) {
        const decision = await this.smartRouter.resolve(RouteKey.CHAT, {
          message: input,
        });
        modelOverride = decision.model;
      } else {
        const localAgentResult = await this.integrationAdapter.process(
          input,
          messages
        );
        if (!localAgentResult.shouldContinueToQueryEngine) {
          yield {
            type: 'content_block_delta',
            data: { delta: localAgentResult.result?.response || '' },
          };
          yield { type: 'message_stop', data: undefined };
          return;
        }
      }
    }

    const { model, maxTurns } = params;
    const effectiveModel = modelOverride || model || this.defaultModel;
    let currentMessages = [...messages];
    let currentTurn = 0;
    const maxIterations = maxTurns || 10;

    while (currentTurn < maxIterations) {
      if (this.abortController?.signal.aborted) {
        yield { type: 'message_stop', data: undefined };
        return;
      }

      currentTurn++;
      let fullContent = '';

      try {
        const streamIterable = (this.client as any).stream?.(currentMessages, {
          model: effectiveModel,
          tools: options?.tools,
        });

        if (!streamIterable) {
          yield {
            type: 'error',
            data: { error: 'Provider does not support streaming' },
          };
          return;
        }

        for await (const event of streamIterable) {
          if (event.type === 'content_block_delta') {
            fullContent += event.delta;
            yield { type: 'content_block_delta', data: { delta: event.delta } };
          } else if (event.type === 'tool_call') {
            yield {
              type: 'content_block_delta',
              data: { delta: `[Tool: ${event.tool_call?.name}]` },
            };
          }
        }

        yield { type: 'message_stop', data: { content: fullContent } };
        return;
      } catch (error) {
        yield {
          type: 'error',
          data: {
            error: error instanceof Error ? error.message : String(error),
          },
        };
        return;
      }
    }
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private buildQueryParams(
    messages: ChatMessage[],
    options?: QueryOptions
  ): QueryParams {
    return {
      messages,
      model: options?.model,
      tools: options?.tools as any,
      maxTokens: options?.maxTokens,
      temperature: options?.temperature,
      maxTurns: options?.maxTurns,
    };
  }

  private async executeWithLocalAgent(
    params: QueryParams
  ): Promise<QueryResult> {
    const { messages } = params;
    const input = this.extractUserInput(messages);

    if (!input) {
      return this.executeDirectQuery(params);
    }

    // SmartRouter 决策管线（优先）：带 FallbackChain + RetryPolicy
    if (this.smartRouter?.isEnabled()) {
      let actualResult: QueryResult | null = null;

      await this.smartRouter.execute(
        RouteKey.CHAT,
        async (decision) => {
          actualResult = await this.executeDirectQuery({
            ...params,
            model: decision.model || params.model,
          });
          return {
            success: !actualResult.error,
            content: actualResult.message?.content,
            error: actualResult.error,
          };
        },
        { message: input }
      );

      return actualResult!;
    }

    // 原有 LocalAgent 预分类路径
    const localAgentResult = await this.integrationAdapter.process(
      input,
      messages
    );

    if (!localAgentResult.shouldContinueToQueryEngine) {
      return {
        message: {
          role: 'assistant',
          content: localAgentResult.result?.response || '',
        },
        allMessages: messages,
        turns: 0,
        finishReason: 'local_agent_handled' as any,
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

  enableLocalAgent(config?: {
    bypassRoutes?: string[];
    enableMetrics?: boolean;
  }): void {
    this.integrationAdapter = createIntegrationAdapter({
      enabled: true,
      bypassRoutes: config?.bypassRoutes as any,
      enableMetrics: config?.enableMetrics ?? false,
    });
  }

  disableLocalAgent(): void {
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
