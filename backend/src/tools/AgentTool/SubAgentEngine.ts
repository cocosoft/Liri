/**
 * SubAgentEngine - 子代理查询循环引擎
 *
 * 对标 CC 源码 runAgent.ts 实现完整的子代理执行生命周期：
 * 1. 调用 LLM 获取响应
 * 2. 解析 tool_use 请求
 * 3. 执行工具并返回结果
 * 4. 重复直到任务完成
 * 5. 支持最大轮次限制和中断
 */

import { randomUUID } from 'crypto';
import type { ChatMessage, ChatResponse, ToolDefinition } from '../../ai/models/types';
import type { Tool } from '../types/Tool';
import { ToolExecutionStatus } from '../types/ToolResult';
import { DeepSeekClient } from '../../ai/clients/DeepSeekClient';

/**
 * 子代理进度事件类型
 */
export interface SubAgentProgressEvent {
  /** 子代理 ID */
  agentId: string;
  /** 事件类型 */
  type: 'thinking' | 'tool_use' | 'tool_result' | 'progress' | 'complete' | 'error';
  /** 事件消息 */
  message: string;
  /** 工具调用 ID（工具调用时） */
  toolUseId?: string;
  /** 工具名称（工具调用时） */
  toolName?: string;
  /** 当前轮次 */
  turn?: number;
  /** 总轮次限制 */
  maxTurns?: number;
}

/**
 * 子代理引擎配置
 */
export interface SubAgentEngineConfig {
  /** 默认最大轮次 */
  defaultMaxTurns: number;
  /** 默认模型 */
  defaultModel: string;
  /** 超时时间（毫秒） */
  timeoutMs: number;
}

/**
 * 子代理执行请求
 */
export interface SubAgentRequest {
  /** Agent ID（自动生成可为空） */
  agentId?: string;
  /** 系统提示词 */
  systemPrompt: string;
  /** 用户消息列表 */
  messages: ChatMessage[];
  /** 可用工具定义 */
  tools: ToolDefinition[];
  /** 实际工具实例映射（name -> Tool） */
  toolInstances: Map<string, Tool>;
  /** 最大轮次 */
  maxTurns?: number;
  /** 模型覆盖 */
  model?: string;
}

/**
 * 子代理执行结果
 */
export interface SubAgentResult {
  /** Agent ID */
  agentId: string;
  /** 是否完成 */
  completed: boolean;
  /** 最终输出内容 */
  output: string;
  /** 工具调用总次数 */
  toolCallCount: number;
  /** 实际执行轮次 */
  turnsUsed: number;
  /** Token 使用情况 */
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** 错误信息 */
  error?: string;
  /** 执行时长（毫秒） */
  durationMs: number;
}

/**
 * 子代理引擎
 *
 * 管理子代理的完整执行生命周期：
 * - 多轮 LLM 查询循环
 * - 工具调用与结果处理
 * - 进度事件通知
 * - 中断与超时控制
 */
export class SubAgentEngine {
  private config: SubAgentEngineConfig;
  private activeAgents: Map<string, {
    abortController: AbortController;
    startTime: number;
  }> = new Map();

  /**
   * @param config 引擎配置
   */
  constructor(config?: Partial<SubAgentEngineConfig>) {
    this.config = {
      defaultMaxTurns: config?.defaultMaxTurns ?? 50,
      defaultModel: config?.defaultModel ?? 'deepseek-chat',
      timeoutMs: config?.timeoutMs ?? 600000,
    };
  }

  /**
   * 执行子代理任务
   *
   * @param request 子代理执行请求
   * @param onProgress 进度回调
   * @returns 执行结果
   */
  async execute(
    request: SubAgentRequest,
    onProgress?: (event: SubAgentProgressEvent) => void,
  ): Promise<SubAgentResult> {
    const agentId = request.agentId || `sa-${randomUUID().replace(/-/g, '').substring(0, 8)}`;
    const abortController = new AbortController();
    const startTime = Date.now();

    this.activeAgents.set(agentId, { abortController, startTime });

    const maxTurns = request.maxTurns || this.config.defaultMaxTurns;
    let toolCallCount = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    try {
      const llmClient = new DeepSeekClient();

      const messages: ChatMessage[] = [
        { role: 'system', content: request.systemPrompt },
        ...request.messages,
      ];

      for (let turn = 0; turn < maxTurns; turn++) {
        if (abortController.signal.aborted) {
          return this.buildResult(agentId, startTime, {
            completed: false,
            output: '子代理执行被中断',
            toolCallCount,
            turnsUsed: turn,
            tokenUsage: {
              promptTokens: totalPromptTokens,
              completionTokens: totalCompletionTokens,
              totalTokens: totalPromptTokens + totalCompletionTokens,
            },
            error: 'Execution aborted by user',
          });
        }

        onProgress?.({
          agentId,
          type: 'thinking',
          message: `子代理执行第 ${turn + 1}/${maxTurns} 轮`,
          turn: turn + 1,
          maxTurns,
        });

        const response = await this.callLLM(llmClient, messages, request.tools, request.model);

        if (response.usage) {
          totalPromptTokens += response.usage.prompt_tokens || 0;
          totalCompletionTokens += response.usage.completion_tokens || 0;
        }

        if (response.tool_calls && response.tool_calls.length > 0) {
          const assistantMsg: ChatMessage = {
            role: 'assistant',
            content: response.content || '',
            tool_calls: response.tool_calls.map(tc => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              },
            })),
          };
          messages.push(assistantMsg);

          for (const toolCall of response.tool_calls) {
            if (abortController.signal.aborted) break;

            toolCallCount++;
            onProgress?.({
              agentId,
              type: 'tool_use',
              message: `调用工具: ${toolCall.name}`,
              toolUseId: toolCall.id,
              toolName: toolCall.name,
              turn: turn + 1,
              maxTurns,
            });

            const toolResult = await this.executeToolCall(toolCall, request.toolInstances);

            messages.push({
              role: 'tool',
              content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
              tool_call_id: toolCall.id,
            });

            onProgress?.({
              agentId,
              type: 'tool_result',
              message: `工具 ${toolCall.name} 执行完成`,
              toolUseId: toolCall.id,
              toolName: toolCall.name,
              turn: turn + 1,
              maxTurns,
            });
          }
        } else {
          const finalContent = response.content || '';
          const durationMs = Date.now() - startTime;

          this.activeAgents.delete(agentId);

          onProgress?.({
            agentId,
            type: 'complete',
            message: '子代理任务完成',
          });

          return {
            agentId,
            completed: true,
            output: finalContent,
            toolCallCount,
            turnsUsed: turn + 1,
            tokenUsage: {
              promptTokens: totalPromptTokens,
              completionTokens: totalCompletionTokens,
              totalTokens: totalPromptTokens + totalCompletionTokens,
            },
            durationMs,
          };
        }
      }

      this.activeAgents.delete(agentId);

      return this.buildResult(agentId, startTime, {
        completed: false,
        output: '子代理执行达到最大轮次限制',
        toolCallCount,
        turnsUsed: maxTurns,
        tokenUsage: {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          totalTokens: totalPromptTokens + totalCompletionTokens,
        },
        error: `Max turns (${maxTurns}) reached without completion`,
      });
    } catch (error) {
      this.activeAgents.delete(agentId);

      const errorMessage = error instanceof Error ? error.message : String(error);

      onProgress?.({
        agentId,
        type: 'error',
        message: errorMessage,
      });

      return this.buildResult(agentId, startTime, {
        completed: false,
        output: '',
        toolCallCount,
        turnsUsed: 0,
        tokenUsage: {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          totalTokens: totalPromptTokens + totalCompletionTokens,
        },
        error: errorMessage,
      });
    }
  }

  /**
   * 中断子代理执行
   *
   * @param agentId 子代理 ID
   * @returns 是否成功中断
   */
  abort(agentId: string): boolean {
    const agent = this.activeAgents.get(agentId);
    if (!agent) return false;

    agent.abortController.abort();
    this.activeAgents.delete(agentId);
    return true;
  }

  /**
   * 获取所有活跃子代理
   */
  getActiveAgents(): Array<{ agentId: string; elapsedMs: number }> {
    const now = Date.now();
    return Array.from(this.activeAgents.entries()).map(([agentId, agent]) => ({
      agentId,
      elapsedMs: now - agent.startTime,
    }));
  }

  /**
   * 调用 LLM
   */
  private async callLLM(
    client: DeepSeekClient,
    messages: ChatMessage[],
    tools: ToolDefinition[],
    model?: string,
  ): Promise<ChatResponse> {
    return client.chat(messages, {
      tools: tools.length > 0 ? tools : undefined,
      model: model || this.config.defaultModel,
    });
  }

  /**
   * 执行单个工具调用
   */
  private async executeToolCall(
    toolCall: { id: string; name: string; arguments: Record<string, any> },
    toolInstances: Map<string, Tool>,
  ): Promise<string> {
    const tool = toolInstances.get(toolCall.name);
    if (!tool) {
      return JSON.stringify({
        success: false,
        error: `Tool '${toolCall.name}' not found`,
      });
    }

    try {
      const parsedArgs = typeof toolCall.arguments === 'string'
        ? JSON.parse(toolCall.arguments)
        : (toolCall.arguments as Record<string, unknown>);
      const result = await tool.execute(parsedArgs, { messages: [] } as any);
      const output = result.output || result.result || JSON.stringify(result);

      if (typeof output === 'string') return output;

      return JSON.stringify(output);
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 构建执行结果
   */
  private buildResult(
    agentId: string,
    startTime: number,
    partial: {
      completed: boolean;
      output: string;
      toolCallCount: number;
      turnsUsed: number;
      tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
      error?: string;
    },
  ): SubAgentResult {
    return {
      agentId,
      ...partial,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * 创建默认子代理引擎实例
 */
let defaultEngine: SubAgentEngine | null = null;

export function getSubAgentEngine(): SubAgentEngine {
  if (!defaultEngine) {
    defaultEngine = new SubAgentEngine();
  }
  return defaultEngine;
}

export function setSubAgentEngine(engine: SubAgentEngine): void {
  defaultEngine = engine;
}
