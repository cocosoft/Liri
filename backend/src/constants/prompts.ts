/**
 * 提示词模板常量
 * 基于CC源码 cc_code/backend/constants/prompts.ts 实现
 */

export const SYSTEM_PROMPT_SECTIONS = {
  ROLE: '你是一个有用的AI助手。',
  CAPABILITIES: '你可以使用各种工具来帮助用户完成任务。',
  CONSTRAINTS: '请仔细遵循用户的指令。',
  CONTEXT: '结合对话上下文提供相关回应。',
} as const;

export const COMPACT_PROMPT = `对话已较长，为继续有效进行，已对之前的消息进行摘要。摘要保留了关键信息并减少了令牌使用量。`;

export const MEMORY_PROMPT = `基于用户的历史记录和偏好，以下是相关的记忆：`;

export const TOOL_USE_PROMPT = `用户在此会话中使用了以下工具：`;

export const TASK_COMPLETION_PROMPT = `任务已完成。`;

export const ERROR_RECOVERY_PROMPT = `发生错误，请重试或告知是否需要帮助。`;

export const CONTEXT_SUMMARY_PROMPT = `以下是当前上下文的摘要：`;

export const CODE_REVIEW_PROMPT = `请审查以下代码并提供反馈：`;

export const REFACTOR_PROMPT = `请帮助重构以下代码：`;

export const DEBUG_PROMPT = `请帮助调试以下问题：`;

export const TEST_GENERATION_PROMPT = `请帮助为以下代码生成测试：`;

export const DOCUMENTATION_PROMPT = `请帮助为以下代码编写文档：`;

export const SYSTEM_INSTRUCTION_PREFIX = '[系统指令]';

export const USER_INTENT_PREFIX = '[用户意图]';

export const CONTEXT_PREFIX = '[上下文]';

export const REMINDER_PREFIX = '[提醒]';

export const WARNING_PREFIX = '[警告]';

export const ERROR_PREFIX = '[错误]';

export const SUCCESS_PREFIX = '[成功]';

export const INFO_PREFIX = '[信息]';
