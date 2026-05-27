/**
 * 通用代理
 */

import { BaseAgentStrategy } from './agentStrategy';
import type { AgentTask, AgentResponse, AgentContext } from '../models/types';
import { AgentState } from '../models/types';
import aiService from '@modules/ai';
import { AIMessageRole } from '@modules/ai/models/types';
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
