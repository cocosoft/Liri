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
 * 消息
 */
export interface Message {
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
