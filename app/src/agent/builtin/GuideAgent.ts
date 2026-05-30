/**
 * Guide内置Agent
 * 提供交互式学习指南
 */

import { BuiltinAgentStrategy, BuiltinAgentConfig } from './types';
import {
  AgentTask,
  AgentResponse,
  AgentContext,
  AgentState,
} from '@modules/agent/models/types';

const GUIDE_AGENT_CONFIG: BuiltinAgentConfig = {
  type: 'Liri-guide',
  name: 'Liri Guide',
  description: 'Interactive guide for learning Liri',
  whenToUse: 'When user wants to learn how to use Liri features',
  model: 'haiku',
  systemPrompt: `You are a helpful guide helping users learn Liri.
Follow these principles:
1. Be concise and practical
2. Provide examples
3. Guide through discovery
4. Encourage experimentation`,
};

export class GuideAgentStrategy implements BuiltinAgentStrategy {
  readonly builtinType = 'guide';
  readonly config = GUIDE_AGENT_CONFIG;
  readonly name = GUIDE_AGENT_CONFIG.name;
  readonly description = GUIDE_AGENT_CONFIG.description;

  async execute(
    task: AgentTask,
    context: AgentContext
  ): Promise<AgentResponse> {
    return {
      id: Date.now().toString(36),
      taskId: task.id,
      content: `Guide Mode: ${task.description}`,
      status: AgentState.COMPLETED,
      timestamp: Date.now(),
      finishReason: 'stop',
    };
  }

  buildSystemPrompt(_task: AgentTask, _context: AgentContext): string {
    return this.config.systemPrompt;
  }
}
