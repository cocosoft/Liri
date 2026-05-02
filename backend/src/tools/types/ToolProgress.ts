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
  action: string;
  message: string;
  isRunning: boolean;
  isComplete: boolean;
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
  isComplete: boolean = false
): AgentToolProgress {
  return {
    type: 'agent_tool',
    agentName,
    action,
    message,
    isRunning,
    isComplete,
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
