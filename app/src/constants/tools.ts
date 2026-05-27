/**
 * 工具名称常量
 * 基于CC源码 cc_code/backend/constants/tools.ts 实现
 * 统一定义所有工具名称，消除硬编码字符串
 */

/**
 * 核心工具名称
 */
export const BASH_TOOL_NAME = 'Bash';
export const FILE_READ_TOOL_NAME = 'Read';
export const FILE_EDIT_TOOL_NAME = 'Edit';
export const FILE_WRITE_TOOL_NAME = 'Write';
export const GLOB_TOOL_NAME = 'Glob';
export const GREP_TOOL_NAME = 'Grep';
export const WEB_SEARCH_TOOL_NAME = 'WebSearch';
export const WEB_FETCH_TOOL_NAME = 'WebFetch';
export const NOTEBOOK_EDIT_TOOL_NAME = 'NotebookEdit';
export const ASK_USER_QUESTION_TOOL_NAME = 'AskUserQuestion';
export const TODO_WRITE_TOOL_NAME = 'TodoWrite';
export const SKILL_TOOL_NAME = 'Skill';
export const TOOL_SEARCH_TOOL_NAME = 'ToolSearch';

/**
 * Agent相关工具名称
 */
export const AGENT_TOOL_NAME = 'Agent';
export const TASK_OUTPUT_TOOL_NAME = 'TaskOutput';
export const TASK_STOP_TOOL_NAME = 'TaskStop';
export const TASK_CREATE_TOOL_NAME = 'TaskCreate';
export const TASK_GET_TOOL_NAME = 'TaskGet';
export const TASK_LIST_TOOL_NAME = 'TaskList';
export const TASK_UPDATE_TOOL_NAME = 'TaskUpdate';
export const SEND_MESSAGE_TOOL_NAME = 'SendMessage';

/**
 * 模式切换工具名称
 */
export const ENTER_PLAN_MODE_TOOL_NAME = 'EnterPlanMode';
export const EXIT_PLAN_MODE_TOOL_NAME = 'ExitPlanMode';
export const ENTER_WORKTREE_TOOL_NAME = 'EnterWorktree';
export const EXIT_WORKTREE_TOOL_NAME = 'ExitWorktree';

/**
 * 合成输出工具名称
 */
export const SYNTHETIC_OUTPUT_TOOL_NAME = 'SyntheticOutput';

/**
 * 工作流工具名称
 */
export const WORKFLOW_TOOL_NAME = 'Workflow';

/**
 * Shell工具名称集合
 */
export const SHELL_TOOL_NAMES = [BASH_TOOL_NAME] as const;

/**
 * 所有Agent禁止使用的工具集合
 * 防止Agent递归调用和访问主线程抽象
 */
export const ALL_AGENT_DISALLOWED_TOOLS = new Set([
  TASK_OUTPUT_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  AGENT_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_NAME,
  TASK_STOP_TOOL_NAME,
]);

/**
 * 自定义Agent禁止使用的工具集合
 */
export const CUSTOM_AGENT_DISALLOWED_TOOLS = new Set([
  ...ALL_AGENT_DISALLOWED_TOOLS,
]);

/**
 * 异步Agent允许使用的工具集合
 */
export const ASYNC_AGENT_ALLOWED_TOOLS = new Set([
  FILE_READ_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  TODO_WRITE_TOOL_NAME,
  GREP_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  GLOB_TOOL_NAME,
  ...SHELL_TOOL_NAMES,
  FILE_EDIT_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
  NOTEBOOK_EDIT_TOOL_NAME,
  SKILL_TOOL_NAME,
  SYNTHETIC_OUTPUT_TOOL_NAME,
  TOOL_SEARCH_TOOL_NAME,
  ENTER_WORKTREE_TOOL_NAME,
  EXIT_WORKTREE_TOOL_NAME,
]);

/**
 * 进程内队友允许使用的工具集合
 * 这些工具通过inProcessRunner注入，用于Agent间协作
 */
export const IN_PROCESS_TEAMMATE_ALLOWED_TOOLS = new Set([
  TASK_CREATE_TOOL_NAME,
  TASK_GET_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
  TASK_UPDATE_TOOL_NAME,
  SEND_MESSAGE_TOOL_NAME,
]);

/**
 * 协调器模式允许使用的工具集合
 * 协调器只能使用输出和Agent管理工具
 */
export const COORDINATOR_MODE_ALLOWED_TOOLS = new Set([
  AGENT_TOOL_NAME,
  TASK_STOP_TOOL_NAME,
  SEND_MESSAGE_TOOL_NAME,
  SYNTHETIC_OUTPUT_TOOL_NAME,
]);
