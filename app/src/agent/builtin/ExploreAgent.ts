//
/**
 * Explore内置Agent
 * 探索代码库并提供洞察
 */

import { BuiltinAgentStrategy, BuiltinAgentConfig } from './types';
import {
  AgentTask,
  AgentResponse,
  AgentContext,
  AgentState,
} from '@modules/agent/models/types';

const EXPLORE_AGENT_CONFIG: BuiltinAgentConfig = {
  type: 'Liri-explore',
  name: 'Explore Agent',
  description: 'Explore codebase and provide insights',
  whenToUse: 'When user wants to understand or explore the codebase',
  model: '', // 元数据字段；实际调用使用 context.model（模型体系），空值不硬编码
  systemPrompt: `You are exploring the codebase to provide insights.
Follow these principles:
1. Understand the overall structure
2. Identify key patterns and architecture
3. Highlight potential improvements
4. Provide clear explanations`,
};

export class ExploreAgentStrategy implements BuiltinAgentStrategy {
  readonly builtinType = 'explore';
  readonly config = EXPLORE_AGENT_CONFIG;
  readonly name = EXPLORE_AGENT_CONFIG.name;
  readonly description = EXPLORE_AGENT_CONFIG.description;

  async execute(
    task: AgentTask,
    context: AgentContext
  ): Promise<AgentResponse> {
    return {
      id: Date.now().toString(36),
      taskId: task.id,
      content: `Exploration: ${task.description}`,
      status: AgentState.COMPLETED,
      timestamp: Date.now(),
      finishReason: 'stop',
    };
  }

  buildSystemPrompt(_task: AgentTask, _context: AgentContext): string {
    return this.config.systemPrompt;
  }
}
