/**
 * 通用代理
 */

import { BaseAgentStrategy } from './agentStrategy';
import type { AgentTask, AgentResponse, AgentContext } from '../models/types';
import { AgentState } from '../models/types';
import aiService from '../../ai';
import { AIMessageRole } from '../../ai/models/types';

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
    const systemPrompt = `你是一个智能助手，可以帮助用户完成各种任务。

能力：
- 回答问题
- 提供建议
- 写作辅助
- 信息检索
- 任务规划

请根据用户需求，选择合适的工具来完成任务。如果没有合适的工具，请直接回答。`;

    const userMessage = this.buildUserMessage(task);

    const messages = [
      { role: AIMessageRole.SYSTEM, content: systemPrompt },
      { role: AIMessageRole.USER, content: userMessage },
    ];

    const aiResponse = await aiService.generate(messages, context.model, {
      temperature: context.temperature,
      max_tokens: context.maxTokens,
    });

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
