//
/**
 * Verification内置Agent
 * 验证代码变更和测试结果
 */

import { BuiltinAgentStrategy, BuiltinAgentConfig } from './types';
import {
  AgentTask,
  AgentResponse,
  AgentContext,
  AgentState,
} from '@modules/agent/models/types';

const VERIFICATION_AGENT_CONFIG: BuiltinAgentConfig = {
  type: 'Liri-verification',
  name: 'Verification Agent',
  description: 'Verify code changes and test results',
  whenToUse: 'When user wants to verify code correctness or test results',
  model: 'sonnet',
  systemPrompt: `You are a verification expert.
Follow these principles:
1. Check code changes for correctness
2. Verify test results are passing
3. Identify potential issues
4. Provide actionable feedback`,
};

export class VerificationAgentStrategy implements BuiltinAgentStrategy {
  readonly builtinType = 'verification';
  readonly config = VERIFICATION_AGENT_CONFIG;
  readonly name = VERIFICATION_AGENT_CONFIG.name;
  readonly description = VERIFICATION_AGENT_CONFIG.description;

  async execute(
    task: AgentTask,
    context: AgentContext
  ): Promise<AgentResponse> {
    return {
      id: Date.now().toString(36),
      taskId: task.id,
      content: `Verification: ${task.description}`,
      status: AgentState.COMPLETED,
      timestamp: Date.now(),
      finishReason: 'stop',
    };
  }

  buildSystemPrompt(_task: AgentTask, _context: AgentContext): string {
    return this.config.systemPrompt;
  }
}
