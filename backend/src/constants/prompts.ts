/**
 * 提示词模板常量
 * 基于CC源码 cc_code/backend/constants/prompts.ts 实现
 */

export const SYSTEM_PROMPT_SECTIONS = {
  ROLE: 'You are a helpful assistant.',
  CAPABILITIES: 'You have access to various tools to help you assist the user.',
  CONSTRAINTS: 'You should follow the user instructions carefully.',
  CONTEXT:
    'Consider the context of the conversation to provide relevant responses.',
} as const;

export const COMPACT_PROMPT = `This conversation has become quite long. To continue effectively, the previous messages have been summarized. The summary preserves key information while reducing token usage.`;

export const MEMORY_PROMPT = `Based on the user's history and preferences, here are relevant memories:`;

export const TOOL_USE_PROMPT = `The user has used the following tools in this session:`;

export const TASK_COMPLETION_PROMPT = `Task completed successfully.`;

export const ERROR_RECOVERY_PROMPT = `An error occurred. Please try again or let me know if you need assistance.`;

export const CONTEXT_SUMMARY_PROMPT = `Here's a summary of the current context:`;

export const CODE_REVIEW_PROMPT = `Please review the following code and provide feedback:`;

export const REFACTOR_PROMPT = `Please help refactor the following code:`;

export const DEBUG_PROMPT = `Please help debug the following issue:`;

export const TEST_GENERATION_PROMPT = `Please help generate tests for the following code:`;

export const DOCUMENTATION_PROMPT = `Please help document the following code:`;

export const SYSTEM_INSTRUCTION_PREFIX = '[System Instruction]';

export const USER_INTENT_PREFIX = '[User Intent]';

export const CONTEXT_PREFIX = '[Context]';

export const REMINDER_PREFIX = '[Reminder]';

export const WARNING_PREFIX = '[Warning]';

export const ERROR_PREFIX = '[Error]';

export const SUCCESS_PREFIX = '[Success]';

export const INFO_PREFIX = '[Info]';
