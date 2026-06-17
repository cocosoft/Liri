/**
 * Prompt 模块共享类型
 * 避免 PromptAssembler ↔ SystemPromptReport 循环依赖
 */

/**
 * Prompt 组装模式
 */
export type PromptMode = 'full' | 'conversation' | 'minimal' | 'none';
