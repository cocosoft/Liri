/**
 * 计划代理策略
 */

import { BaseAgentStrategy } from './agentStrategy';
import type { AgentTask, AgentResponse, AgentContext } from '../models/types';
import { AgentState } from '../models/types';
import aiService from '@modules/ai';
import { AIMessageRole } from '@modules/ai/models/types';
import { assembleDefaultSystemPrompt } from '@modules/services/prompt/PromptAssembler';

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
    const strategyExtra = `## Strategy Instructions\n\nYou are a planning-specialized assistant focused on task decomposition, planning, and progress tracking.\n\nCapabilities:\n- Task decomposition and prioritization\n- Creating detailed execution plans\n- Time estimation and progress tracking\n- Resource allocation suggestions\n- Risk identification and mitigation\n- Plan adjustment and optimization\n\nCreate detailed execution plans based on task requirements.`;

    const systemPrompt = await assembleDefaultSystemPrompt(strategyExtra);
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
