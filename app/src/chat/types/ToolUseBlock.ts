/**
 * 工具使用块类型定义
 * 用于表示LLM响应中的工具调用块
 */

/**
 * 工具使用块
 */
export interface ToolUseBlock {
  /** 块类型 */
  type: 'tool_use';
  /** 工具使用ID */
  id: string;
  /** 工具名称 */
  name: string;
  /** 工具输入参数 */
  input: Record<string, unknown>;
}

/**
 * 工具结果块
 */
export interface ToolResultBlock {
  /** 块类型 */
  type: 'tool_result';
  /** 工具使用ID */
  tool_use_id: string;
  /** 内容 */
  content: string | ContentBlock[];
  /** 是否错误 */
  is_error?: boolean;
}

/**
 * 内容块
 */
export interface ContentBlock {
  /** 块类型 */
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  /** 文本内容 */
  text?: string;
  /** 工具使用信息 */
  tool_use?: ToolUseBlock;
  /** 工具结果信息 */
  tool_result?: ToolResultBlock;
}

/**
 * 工具使用块消息变体
 *
 * 2026-10-01 数据契约专项 U2（#3）：原名 `Message`，与**规范来源** `chat/types/message.ts`
 * 及其余 6 份同名不同物（本版含 `usage` 且 `content: string | ContentBlock[]`）⇒ 依
 * §9.2 原则 2「一名一规范落点」改名 `ToolUseMessage`（R05-011 长期例外项之一，本次收敛）。
 * ⚠️ 实测：本类型**零消费者**（`chat/types/index.ts` 未转出本文件；按路径 grep 亦零命中）
 * ⇒ 属"未被引用的域内变体"，后续可评估直接删除（另册）。
 */
export interface ToolUseMessage {
  /** 消息角色 */
  role: 'user' | 'assistant' | 'system';
  /** 消息内容 */
  content: string | ContentBlock[];
  /** 使用情况 */
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/**
 * 创建工具使用块
 * @param id 工具使用ID
 * @param name 工具名称
 * @param input 工具输入
 * @returns 工具使用块
 */
export function createToolUseBlock(
  id: string,
  name: string,
  input: Record<string, unknown>
): ToolUseBlock {
  return {
    type: 'tool_use',
    id,
    name,
    input,
  };
}

/**
 * 创建工具结果块
 * @param toolUseId 工具使用ID
 * @param content 内容
 * @param isError 是否错误
 * @returns 工具结果块
 */
export function createToolResultBlock(
  toolUseId: string,
  content: string | ContentBlock[],
  isError?: boolean
): ToolResultBlock {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content,
    is_error: isError,
  };
}
