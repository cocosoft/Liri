/**
 * AgentTool类型定义
 * 定义Agent工具相关的类型
 */

/**
 * Agent类型
 */
export type AgentType =
  | 'general'
  | 'explore'
  | 'plan'
  | 'verification'
  | 'claude-code-guide'
  | 'statusline-setup'
  | 'custom';

/**
 * Agent输入参数
 */
export interface AgentInput {
  /** 任务描述 */
  description: string;
  /** 任务提示 */
  prompt: string;
  /** Agent类型 */
  subagent_type?: AgentType;
  /** 模型覆盖 */
  model?: 'sonnet' | 'opus' | 'haiku';
  /** 是否后台运行 */
  run_in_background?: boolean;
  /** Agent名称 */
  name?: string;
  /** 团队名称 */
  team_name?: string;
  /** 权限模式 */
  mode?: 'plan' | 'bypass';
  /** 工作目录 */
  cwd?: string;
  /** 隔离模式 */
  isolation?: 'worktree';
}

/**
 * Agent输出结果
 */
export interface AgentOutput {
  /** 任务ID */
  task_id?: string;
  /** Agent名称 */
  name?: string;
  /** 执行结果 */
  result?: string;
  /** 是否完成 */
  completed: boolean;
  /** 错误信息 */
  error?: string;
}

/**
 * Agent进度
 */
export interface AgentProgress {
  /** 进度类型 */
  type: 'progress' | 'complete' | 'error';
  /** 消息 */
  message?: string;
  /** 进度百分比 */
  progress?: number;
  /** 结果 */
  result?: string;
  /** 错误 */
  error?: string;
}

/**
 * Agent配置
 */
export interface AgentConfig {
  /** 默认Agent类型 */
  defaultType: AgentType;
  /** 默认模型 */
  defaultModel?: string;
  /** 最大并发数 */
  maxConcurrentAgents: number;
  /** 超时时间(ms) */
  timeoutMs: number;
  /** 是否允许后台运行 */
  allowBackground: boolean;
}

/**
 * 内置Agent定义
 */
export interface BuiltInAgent {
  /** Agent名称 */
  name: string;
  /** Agent类型 */
  type: AgentType;
  /** 描述 */
  description: string;
  /** 系统提示 */
  systemPrompt?: string;
  /** 是否支持后台运行 */
  supportBackground: boolean;
  /** 默认模型 */
  defaultModel?: string;
}
