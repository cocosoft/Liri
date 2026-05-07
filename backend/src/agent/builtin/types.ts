/**
 * 内置Agent类型定义
 */

import { AgentStrategy, AgentTask, AgentResponse, AgentContext } from '@modules/models/types';

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
