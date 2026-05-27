/**
 * 工具调用解析器类型定义
 * 对标 Hermes environments/tool_call_parsers/__init__.py（ToolCallParser + ParseResult）
 */

/**
 * 解析出的单个工具调用
 */
export interface ParsedToolCall {
  /** 生成的唯一标识 */
  id: string;
  /** 工具名称 */
  name: string;
  /** JSON 格式参数 */
  arguments: string;
}

/**
 * 解析器返回结果
 * 对标 Hermes ParseResult = (content, tool_calls)
 */
export interface ParsedResult {
  /** 去除工具调用标记后的纯文本内容，若整个输出均为工具调用则为 null */
  content: string | null;
  /** 解析出的工具调用列表，无工具调用时为 null */
  toolCalls: ParsedToolCall[] | null;
}

/**
 * 从纯文本创建空解析结果
 */
export function emptyParsedResult(content: string): ParsedResult {
  return { content, toolCalls: null };
}

/**
 * 从工具调用列表创建解析结果
 */
export function toolCallResult(
  content: string | null,
  toolCalls: ParsedToolCall[]
): ParsedResult {
  return {
    content: content || null,
    toolCalls: toolCalls.length > 0 ? toolCalls : null,
  };
}
