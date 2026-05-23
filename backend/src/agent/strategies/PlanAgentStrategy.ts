/**
 * 计划代理策略
 */

import { BaseAgentStrategy } from './agentStrategy';
import type { AgentTask, AgentResponse, AgentContext } from '../models/types';
import { AgentState } from '../models/types';
import aiService from '@modules/ai';
import { AIMessageRole } from '@modules/ai/models/types';
import { assembleSystemPrompt } from '@modules/services/prompt/PromptAssembler';

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
    const strategyExtra = `## 策略说明\n\n你是一个规划专家助手，专注于任务分解、规划和进度跟踪。\n\n能力范围：\n- 任务分解和优先级排序\n- 创建详细执行计划\n- 时间估算和进度跟踪\n- 资源分配建议\n- 风险识别和缓解\n- 计划调整和优化\n\n根据任务需求创建详细的执行计划。`;

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
