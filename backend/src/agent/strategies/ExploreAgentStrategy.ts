/**
 * 探索代理策略
 */

import { BaseAgentStrategy } from './agentStrategy';
import type { AgentTask, AgentResponse, AgentContext } from '../models/types';
import { AgentState } from '../models/types';
import aiService from '@modules/ai';
import { AIMessageRole } from '@modules/ai/models/types';

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
    const systemPrompt = `你是一个探索型助手，专注于信息收集、分析和发现。

你的能力：
- 网络搜索和内容获取
- 文档阅读和理解
- 信息提取和整理
- 关联分析和发现
- 趋势识别
- 对比分析

当你需要使用工具时，请明确指出工具名称和参数。`;

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
