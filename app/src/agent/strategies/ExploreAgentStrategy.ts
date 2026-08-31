/**
 * 探索代理策略
 */

import { BaseAgentStrategy } from './agentStrategy';
import type { AgentTask, AgentResponse, AgentContext } from '../models/types';
import { AgentState } from '../models/types';
import aiService from '@modules/ai';
import { AIMessageRole } from '@modules/ai';
import { assembleSystemPrompt } from '@modules/services/prompt/PromptAssembler';

/**
 * 探索代理策略
 */
export class ExploreAgentStrategy extends BaseAgentStrategy {
  constructor() {
    super('explore', '探索代理策略，专注于信息收集、分析和发现');
  }

  async execute(
    task: AgentTask,
    context: AgentContext
  ): Promise<AgentResponse> {
    const strategyExtra = `## 策略说明\n\n你是一个探索专家助手，专注于信息收集、分析和发现。\n\n能力范围：\n- 网络搜索和内容检索\n- 文档阅读和理解\n- 信息提取和组织\n- 关联分析和发现\n- 趋势识别\n- 比较分析\n\n使用工具时，明确指定工具名称和参数。`;

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
      temperature: 0.5,
      max_tokens: context.maxTokens,
      tools: this.buildToolDefinitions(context),
    });

    // E1：统一处理原生 tool_calls（此前与 General/Plan 不一致，工具注入但结果被丢弃）
    if (aiResponse.tool_calls && aiResponse.tool_calls.length > 0) {
      try {
        const toolResults = await this.executeToolCalls(
          aiResponse.tool_calls,
          context
        );
        const finalResponse = await this.generateWithToolResults(
          messages,
          context,
          aiResponse.content,
          aiResponse.tool_calls,
          toolResults
        );
        if (finalResponse) return finalResponse;
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
