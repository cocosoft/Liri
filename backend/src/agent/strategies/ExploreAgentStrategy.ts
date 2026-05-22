/**
 * 探索代理策略
 */

import { BaseAgentStrategy } from './agentStrategy';
import type { AgentTask, AgentResponse, AgentContext } from '../models/types';
import { AgentState } from '../models/types';
import aiService from '@modules/ai';
import { AIMessageRole } from '@modules/ai/models/types';
import { assembleDefaultSystemPrompt } from '@modules/services/prompt/PromptAssembler';

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
    const strategyExtra = `## Strategy Instructions\n\nYou are an exploration-specialized assistant focused on information gathering, analysis, and discovery.\n\nCapabilities:\n- Web search and content retrieval\n- Document reading and comprehension\n- Information extraction and organization\n- Correlation analysis and discovery\n- Trend identification\n- Comparative analysis\n\nWhen using tools, clearly specify the tool name and parameters.`;

    const systemPrompt = await assembleDefaultSystemPrompt(strategyExtra);
    const userMessage = this.buildUserMessage(task);

    const messages = [
      { role: AIMessageRole.SYSTEM, content: systemPrompt },
      { role: AIMessageRole.USER, content: userMessage },
    ];

    const aiResponse = await aiService.generate(messages, context.model, {
      temperature: 0.5,
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
