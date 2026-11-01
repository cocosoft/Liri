/**
 * Prompt 模块共享类型
 * 避免 PromptAssembler ↔ SystemPromptReport 循环依赖
 */

/**
 * Prompt 组装模式
 * 'local': 本地模型（llama.cpp/Ollama 等）精简模式 — 只保留核心段落，去掉依赖
 *          已裁剪工具的规则（taskNegotiation/shellDeclaration/toolIntegrity）
 */
export type PromptMode = 'full' | 'conversation' | 'minimal' | 'none' | 'local';
