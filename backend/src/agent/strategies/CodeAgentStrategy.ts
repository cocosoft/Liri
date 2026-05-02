/**
 * 代码代理策略
 */

import { BaseAgentStrategy } from './agentStrategy';
import type { AgentTask, AgentResponse, AgentContext } from '../models/types';
import { AgentState } from '../models/types';
import aiService from '../../ai';
import { AIMessageRole } from '../../ai/models/types';

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
    const systemPrompt = `你是一个专业的代码助手，专注于帮助用户编写、调试和优化代码。

你的能力：
- 编写高质量代码
- 代码调试和错误修复
- 代码审查和优化
- 解释代码逻辑
- 生成测试用例
- 提供代码重构建议

当你需要使用工具时，请明确指出工具名称和参数。`;

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
