/**
 * 代码代理策略
 */

import { BaseAgentStrategy } from './agentStrategy';
import type { AgentTask, AgentResponse, AgentContext } from '../models/types';
import { AgentState } from '../models/types';
import aiService from '@modules/ai';
import { AIMessageRole } from '@modules/ai/models/types';
import { assembleDefaultSystemPrompt } from '@modules/services/prompt/PromptAssembler';

/**
 * 代码代理策略
 */
export class CodeAgentStrategy extends BaseAgentStrategy {
  constructor() {
    super('code', '代码代理策略，专注于代码编写、调试和优化');
  }

  async execute(
    task: AgentTask,
    context: AgentContext
  ): Promise<AgentResponse> {
    const strategyExtra = `## Strategy Instructions\n\nYou are a code-specialized assistant focused on writing, debugging, and optimizing code.\n\nCapabilities:\n- Writing high-quality code\n- Debugging and fixing errors\n- Code review and optimization\n- Explaining code logic\n- Generating test cases\n- Providing refactoring suggestions\n\nWhen using tools, clearly specify the tool name and parameters.`;

    const systemPrompt = await assembleDefaultSystemPrompt(strategyExtra);
    const userMessage = this.buildUserMessage(task);

    const messages = [
      { role: AIMessageRole.SYSTEM, content: systemPrompt },
      { role: AIMessageRole.USER, content: userMessage },
    ];

    const aiResponse = await aiService.generate(messages, context.model, {
      temperature: 0.2,
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
