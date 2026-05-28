// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
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
