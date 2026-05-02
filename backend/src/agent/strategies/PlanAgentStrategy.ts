/**
 * 计划代理策略
 */

import { BaseAgentStrategy } from './agentStrategy';
import type { AgentTask, AgentResponse, AgentContext } from '../models/types';
import { AgentState } from '../models/types';
import aiService from '../../ai';
import { AIMessageRole } from '../../ai/models/types';

/**
 * 计划代理策略
 */
export class PlanAgentStrategy extends BaseAgentStrategy {
  constructor() {
    super('plan', '计划代理策略，专注于任务分解、规划和进度跟踪');
  }

  async execute(
    task: AgentTask,
    context: AgentContext
  ): Promise<AgentResponse> {
    const systemPrompt = `你是一个计划型助手，专注于任务分解、规划和进度跟踪。

你的能力：
- 任务分解和优先级排序
- 制定详细执行计划
- 时间估算和进度跟踪
- 资源调配建议
- 风险识别和应对
- 计划调整和优化

请根据任务需求，制定详细的执行计划。`;

    const userMessage = this.buildUserMessage(task);

    const messages = [
      { role: AIMessageRole.SYSTEM, content: systemPrompt },
      { role: AIMessageRole.USER, content: userMessage },
    ];

    const aiResponse = await aiService.generate(messages, context.model, {
      temperature: 0.6,
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
