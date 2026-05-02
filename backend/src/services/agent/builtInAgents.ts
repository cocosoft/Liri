/**
 * 内置Agent定义
 */

import { BuiltInAgentDefinition } from './types';
import {
  VERIFICATION_AGENT_DEFINITION,
} from '../../tools/AgentTool/strategies/VerificationStrategy';
import {
  STATUSLINE_SETUP_AGENT_DEFINITION,
} from '../../tools/AgentTool/strategies/StatuslineStrategy';

/**
 * 获取内置Agent列表
 */
export function getBuiltInAgents(): BuiltInAgentDefinition[] {
  return [
    {
      agentType: 'general-purpose',
      whenToUse: 'General purpose coding and debugging',
      source: 'built-in',
      baseDir: 'built-in',
      getSystemPrompt: () => {
        return `You are a helpful coding assistant. Your primary goal is to help users with their coding tasks, including debugging, refactoring, and implementing new features.`;
      }
    },
    {
      agentType: 'explore',
      whenToUse: 'Explore codebase structure and understand existing code',
      source: 'built-in',
      baseDir: 'built-in',
      getSystemPrompt: () => {
        return `You are an exploration assistant. Your goal is to help users understand codebase structure, identify key components, and provide insights about the code.`;
      }
    },
    {
      agentType: 'plan',
      whenToUse: 'Plan complex coding tasks and features',
      source: 'built-in',
      baseDir: 'built-in',
      getSystemPrompt: () => {
        return `You are a planning assistant. Your goal is to help users plan complex coding tasks, break them down into manageable steps, and create implementation strategies.`;
      }
    },
    VERIFICATION_AGENT_DEFINITION,
    {
      agentType: 'claude-code-guide',
      whenToUse: 'Code review and best practices',
      source: 'built-in',
      baseDir: 'built-in',
      getSystemPrompt: () => {
        return `You are a code guide assistant. Your goal is to help users write clean, efficient, and maintainable code by providing best practices and code review feedback.`;
      }
    },
    STATUSLINE_SETUP_AGENT_DEFINITION,
  ];
}
