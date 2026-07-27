/**
 * 通用代理
 */

import { BaseAgentStrategy } from './agentStrategy';
import type { AgentTask, AgentResponse, AgentContext } from '../models/types';
import { AgentState } from '../models/types';
import aiService from '@modules/ai';
import { AIMessageRole } from '@modules/ai';
import { assembleSystemPrompt } from '@modules/services/prompt/PromptAssembler';

/**
 * 通用代理策略
 */
export class GeneralAgentStrategy extends BaseAgentStrategy {
  constructor() {
    super('general', '通用代理策略，适用于日常对话和简单任务');
  }

  async execute(
    task: AgentTask,
    context: AgentContext
  ): Promise<AgentResponse> {
    const strategyExtra = `## 策略说明\n\n你是一个通用助手，能够处理广泛类型的任务。\n\n能力范围：\n- 回答问题\n- 提供建议\n- 写作辅助\n- 信息检索\n- 任务规划\n\n根据用户需求选择合适的工具。如果没有合适的工具，直接回复。`;

    const systemPrompt = await assembleSystemPrompt({
      strategyExtra,
      mode: context.promptMode,
    });
    const userMessage = this.buildUserMessage(task);

    const messages = [
      { role: AIMessageRole.SYSTEM, content: systemPrompt },
      { role: AIMessageRole.USER, content: userMessage },
    ];

    const aiResponse = await aiService.generate(messages, context.model, {
      temperature: context.temperature,
      max_tokens: context.maxTokens,
      tools: this.buildToolDefinitions(context),
    });

    // N1 修复: 处理原生 function calling 返回的 tool_calls
    if (aiResponse.tool_calls && aiResponse.tool_calls.length > 0) {
      try {
        const toolResults: Array<{
          name: string;
          result: unknown;
          error?: string;
        }> = [];
        for (const tc of aiResponse.tool_calls) {
          const tool = context.tools.find((t) => t.name === tc.name);
          if (tool) {
            try {
              const result = await tool.execute(tc.arguments ?? {});
              toolResults.push({ name: tc.name, result });
            } catch (execErr) {
              toolResults.push({
                name: tc.name,
                result: null,
                error: (execErr as Error).message,
              });
            }
          }
        }

        if (toolResults.length > 0) {
          const toolResultSummary = toolResults
            .map(
              (tr) =>
                `${tr.name}: ${tr.error ? `ERROR: ${tr.error}` : JSON.stringify(tr.result, null, 2)}`
            )
            .join('\n');
          messages.push({
            role: AIMessageRole.ASSISTANT,
            content:
              aiResponse.content ||
              `调用工具: ${aiResponse.tool_calls.map((tc) => tc.name).join(', ')}`,
          });
          messages.push({
            role: AIMessageRole.USER,
            content: `Tool execution results:\n${toolResultSummary}`,
          });

          const finalResponse = await aiService.generate(
            messages,
            context.model,
            {
              temperature: context.temperature,
              max_tokens: context.maxTokens,
              tools: this.buildToolDefinitions(context),
            }
          );

          return {
            id: finalResponse.id,
            taskId: task.id,
            content: finalResponse.content,
            result: { toolResults },
            status: AgentState.COMPLETED,
            usage: finalResponse.usage
              ? {
                  promptTokens: finalResponse.usage.prompt_tokens,
                  completionTokens: finalResponse.usage.completion_tokens,
                  totalTokens: finalResponse.usage.total_tokens,
                }
              : undefined,
            timestamp: Date.now(),
            finishReason: finalResponse.finish_reason,
          };
        }
      } catch (error) {
        return {
          id: aiResponse.id,
          taskId: task.id,
          content: `Error: ${(error as Error).message}`,
          status: AgentState.FAILED,
          error: (error as Error).message,
          timestamp: Date.now(),
        };
      }
    }

    return {
      id: aiResponse.id,
      taskId: task.id,
      content: aiResponse.content,
      status: AgentState.COMPLETED,
      usage: aiResponse.usage
        ? {
            promptTokens: aiResponse.usage.prompt_tokens,
            completionTokens: aiResponse.usage.completion_tokens,
            totalTokens: aiResponse.usage.total_tokens,
          }
        : undefined,
      timestamp: Date.now(),
      finishReason: aiResponse.finish_reason,
    };
  }
}
