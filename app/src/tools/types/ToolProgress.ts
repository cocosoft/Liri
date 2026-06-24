/**
 * 工具执行进度类型
 * 参考CC_CODE的ToolProgress设计，适应backend现有架构
 */

/**
 * 工具进度数据类型
 */
export type ToolProgressData =
  | BashProgress
  | WebSearchProgress
  | TaskOutputProgress
  | AgentToolProgress
  | REPLToolProgress
  | MCPProgress
  | SkillToolProgress
  | { type: 'unknown' };

/**
 * Bash工具进度类型
 */
export interface BashProgress {
  type: 'bash';
  stdout: string;
  stderr: string;
  exitCode?: number;
  isRunning: boolean;
  isComplete: boolean;
}

/**
 * Web搜索工具进度类型
 */
export interface WebSearchProgress {
  type: 'web_search';
  query: string;
  results: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
  isRunning: boolean;
  isComplete: boolean;
}

/**
 * 任务输出进度类型
 */
export interface TaskOutputProgress {
  type: 'task_output';
  taskId: string;
  output: string;
  isRunning: boolean;
  isComplete: boolean;
}

/**
 * 代理工具进度类型
 */
export interface AgentToolProgress {
  type: 'agent_tool';
  agentName: string;
  /** 子 Agent ID */
  agentId?: string;
  action: string;
  message: string;
  isRunning: boolean;
  isComplete: boolean;
  /** 当前轮次 */
  turn?: number;
  /** 最大轮次 */
  maxTurns?: number;
  /** 当前工具调用名称 */
  toolName?: string;
  /** 当前工具调用 ID */
  toolUseId?: string;
  /** 并行子 Agent 列表（council 模式） */
  subAgents?: SubAgentProgress[];
}

/** 子 Agent 进度快照 */
export interface SubAgentProgress {
  agentId: string;
  agentName: string;
  status: 'running' | 'completed' | 'failed';
  /** 最新消息 */
  lastMessage: string;
  /** 当前轮次 */
  turn?: number;
  /** 当前工具调用 */
  toolName?: string;
}

/**
 * REPL工具进度类型
 */
export interface REPLToolProgress {
  type: 'repl';
  command: string;
  output: string;
  isRunning: boolean;
  isComplete: boolean;
}

/**
 * MCP工具进度类型
 */
export interface MCPProgress {
  type: 'mcp';
  serverName: string;
  toolName: string;
  progress: any;
  isRunning: boolean;
  isComplete: boolean;
}

/**
 * 技能工具进度类型
 */
export interface SkillToolProgress {
  type: 'skill_tool';
  skillName: string;
  action: string;
  message: string;
  isRunning: boolean;
  isComplete: boolean;
}

/**
 * 工具进度类型
 */
export interface ToolProgress<P extends ToolProgressData = ToolProgressData> {
  toolUseID: string;
  data: P;
}

/**
 * 创建Bash工具进度
 */
export function createBashProgress(
  stdout: string = '',
  stderr: string = '',
  exitCode?: number,
  isRunning: boolean = true,
  isComplete: boolean = false
): BashProgress {
  return {
    type: 'bash',
    stdout,
    stderr,
    exitCode,
    isRunning,
    isComplete,
  };
}

/**
 * 创建Web搜索工具进度
 */
export function createWebSearchProgress(
  query: string,
  results: Array<{
    title: string;
    url: string;
    snippet: string;
  }> = [],
  isRunning: boolean = true,
  isComplete: boolean = false
): WebSearchProgress {
  return {
    type: 'web_search',
    query,
    results,
    isRunning,
    isComplete,
  };
}

/**
 * 创建任务输出工具进度
 */
export function createTaskOutputProgress(
  taskId: string,
  output: string = '',
  isRunning: boolean = true,
  isComplete: boolean = false
): TaskOutputProgress {
  return {
    type: 'task_output',
    taskId,
    output,
    isRunning,
    isComplete,
  };
}

/**
 * 创建代理工具进度
 */
export function createAgentToolProgress(
  agentName: string,
  action: string,
  message: string = '',
  isRunning: boolean = true,
  isComplete: boolean = false,
  extra?: {
    agentId?: string;
    turn?: number;
    maxTurns?: number;
    toolName?: string;
    toolUseId?: string;
    subAgents?: SubAgentProgress[];
  }
): AgentToolProgress {
  return {
    type: 'agent_tool',
    agentName,
    agentId: extra?.agentId,
    action,
    message,
    isRunning,
    isComplete,
    turn: extra?.turn,
    maxTurns: extra?.maxTurns,
    toolName: extra?.toolName,
    toolUseId: extra?.toolUseId,
    subAgents: extra?.subAgents,
  };
}

/**
 * 创建REPL工具进度
 */
export function createREPLToolProgress(
  command: string,
  output: string = '',
  isRunning: boolean = true,
  isComplete: boolean = false
): REPLToolProgress {
  return {
    type: 'repl',
    command,
    output,
    isRunning,
    isComplete,
  };
}

/**
 * 创建MCP工具进度
 */
export function createMCPProgress(
  serverName: string,
  toolName: string,
  progress: any = {},
  isRunning: boolean = true,
  isComplete: boolean = false
): MCPProgress {
  return {
    type: 'mcp',
    serverName,
    toolName,
    progress,
    isRunning,
    isComplete,
  };
}

/**
 * 创建技能工具进度
 */
export function createSkillToolProgress(
  skillName: string,
  action: string,
  message: string = '',
  isRunning: boolean = true,
  isComplete: boolean = false
): SkillToolProgress {
  return {
    type: 'skill_tool',
    skillName,
    action,
    message,
    isRunning,
    isComplete,
  };
}
