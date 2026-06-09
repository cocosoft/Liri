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
 * 核心类型定义
 */

/**
 * 基础消息接口
 *
 * 这是 core 层的基础 Message 类型。session 模块另有扩展的会话消息模型：
 *   - session/models/SessionMessage.ts — 含元数据、状态字段的 SessionMessage
 *   - session/types/Session.ts — SessionInfo/SessionMetadata 等会话元数据类型
 *   - channels/types/IChannel.ts — 通道层的 IChannelMessage
 */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult<T = unknown> {
  success?: boolean;
  output?: string;
  error?: string;
  data?: T;
  newMessages?: Message[];
  contextModifier?: (context: unknown) => unknown;
  mcpMeta?: {
    _meta?: Record<string, unknown>;
    structuredContent?: Record<string, unknown>;
  };
}

export interface ToolContext {
  cwd: string;
  apiKey?: string;
}
