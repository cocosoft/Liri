/**
 * 内置Agent类型定义
 */

import { AgentStrategy, AgentResponse, AgentState, AgentTask, AgentContext } from '@modules/agent/models/types';

export interface BuiltinAgentConfig {
  type: string;
  name: string;
  description: string;
  whenToUse: string;
  model: 'sonnet' | 'opus' | 'haiku';
  systemPrompt: string;
}

export interface BuiltinAgentStrategy extends AgentStrategy {
  readonly builtinType: string;
  readonly config: BuiltinAgentConfig;
}
