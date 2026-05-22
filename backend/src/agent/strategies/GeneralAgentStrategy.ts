/**
 * 通用代理
 */

import { BaseAgentStrategy } from './agentStrategy';
import type { AgentTask, AgentResponse, AgentContext } from '../models/types';
import { AgentState } from '../models/types';
import aiService from '@modules/ai';
import { AIMessageRole } from '@modules/ai/models/types';
import { assembleDefaultSystemPrompt } from '@modules/services/prompt/PromptAssembler';

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
    const strategyExtra = `## Strategy Instructions\n\nYou are a general-purpose assistant capable of handling a wide range of tasks.\n\nCapabilities:\n- Answering questions\n- Providing suggestions\n- Writing assistance\n- Information retrieval\n- Task planning\n\nSelect appropriate tools based on user needs. If no suitable tool exists, respond directly.`;

    const systemPrompt = await assembleDefaultSystemPrompt(strategyExtra);
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
