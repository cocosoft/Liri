/**
 * AgentTool常量定义
 */

/**
 * AgentTool名称
 */
export const AGENT_TOOL_NAME = 'Agent';

/**
 * 传统AgentTool名称(向后兼容)
 */
export const LEGACY_AGENT_TOOL_NAME = 'Task';

/**
 * 验证Agent类型
 */
export const VERIFICATION_AGENT_TYPE = 'verification';

/**
 * 内置Agent类型 - 一次性执行并返回报告
 */
export const ONE_SHOT_BUILTIN_AGENT_TYPES: ReadonlySet<string> = new Set([
  'Explore',
  'Plan',
]);

/**
 * Agent搜索提示
 */
export const AGENT_SEARCH_HINT = 'create agent task subagent';

/**
 * Agent描述
 */
export const AGENT_DESCRIPTION = `Create a specialized sub-agent to perform a specific task. The agent will be spawned with its own context and can use tools independently.`;

/**
 * 内置Agent定义
 */
export const BUILTIN_AGENTS = {
  general: {
    name: 'General',
    type: 'general' as const,
    description: 'General purpose agent for various tasks',
    supportBackground: true,
  },
  explore: {
    name: 'Explore',
    type: 'explore' as const,
    description: 'Explore codebase and gather information',
    supportBackground: true,
  },
  plan: {
    name: 'Plan',
    type: 'plan' as const,
    description: 'Create a plan for implementing a feature or fix',
    supportBackground: false,
  },
  verification: {
    name: 'Verification',
    type: 'verification' as const,
    description: 'Verify code changes or test results',
    supportBackground: true,
  },
  'claude-code-guide': {
    name: 'Code Guide',
    type: 'claude-code-guide' as const,
    description: 'Code review and best practices guidance',
    supportBackground: true,
  },
  'statusline-setup': {
    name: 'StatusLine',
    type: 'statusline-setup' as const,
    description: 'Configure terminal status line display',
    supportBackground: false,
  },
};
