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
 * 消息模型 —— 内容块 / 压缩边界 / 工具摘要 / 附件消息（C3 拆分，2026-10-09）
 *
 * 自 `session/types/message.ts` 拆出（R04-001 尺寸债治理）。对外 API 由该 barrel 原样重导出。
 */

import type { MessageAttachment, MessageRole, MessageType } from './enums';

/**
 * 内容块类型
 */
export enum ContentBlockType {
  /**
   * 文本
   */
  TEXT = 'text',

  /**
   * 代码
   */
  CODE = 'code',

  /**
   * 工具调用
   */
  TOOL_CALL = 'tool_call',

  /**
   * 工具结果
   */
  TOOL_RESULT = 'tool_result',
}

/**
 * 内容块
 */
export interface ContentBlock {
  /**
   * 内容类型
   */
  type: ContentBlockType;

  /**
   * 内容值
   */
  value: string;

  /**
   * 语言（仅适用于代码类型）
   */
  language?: string;

  /**
   * 工具调用ID（仅适用于工具调用类型）
   */
  toolCallId?: string;

  /**
   * 工具名称（仅适用于工具调用类型）
   */
  toolName?: string;

  /**
   * 工具参数（仅适用于工具调用类型）
   */
  toolArgs?: Record<string, unknown>;
}

/**
 * 压缩边界类型枚举
 */
export enum CompactBoundaryType {
  /**
   * 上下文压缩开始
   */
  CONTEXT_START = 'context_start',

  /**
   * 上下文压缩结束
   */
  CONTEXT_END = 'context_end',

  /**
   * 摘要插入点
   */
  SUMMARY_INSERT = 'summary_insert',

  /**
   * 历史截断点
   */
  HISTORY_TRUNCATED = 'history_truncated',
}

/**
 * 压缩边界消息接口
 */
export interface CompactBoundaryMessage {
  /**
   * 消息ID
   */
  id: string;

  /**
   * 消息类型
   */
  type: MessageType.COMPACT_BOUNDARY;

  /**
   * 边界类型
   */
  boundaryType: CompactBoundaryType;

  /**
   * 被压缩的消息数量
   */
  compressedMessageCount?: number;

  /**
   * 被压缩的token数量
   */
  compressedTokenCount?: number;

  /**
   * 压缩原因
   */
  compressionReason?: string;

  /**
   * 原始上下文摘要
   */
  contextSummary?: string;

  /**
   * 创建时间
   */
  createdAt: Date;

  /**
   * 会话ID
   */
  sessionId?: string;

  /**
   * 元数据
   */
  metadata?: Record<string, unknown>;
}

/**
 * 工具调用摘要接口
 */
export interface ToolUseSummary {
  /**
   * 工具调用ID
   */
  toolCallId: string;

  /**
   * 工具名称
   */
  toolName: string;

  /**
   * 工具调用参数
   */
  toolArguments: Record<string, unknown>;

  /**
   * 工具执行结果摘要
   */
  resultSummary: string;

  /**
   * 工具执行状态
   */
  status: 'success' | 'failed' | 'pending';

  /**
   * 执行时间（毫秒）
   */
  executionTime?: number;

  /**
   * 是否对当前任务有帮助
   */
  helpful?: boolean;
}

/**
 * 工具调用摘要消息接口
 */
export interface ToolUseSummaryMessage {
  /**
   * 消息ID
   */
  id: string;

  /**
   * 消息类型
   */
  type: MessageType.TOOL_USE_SUMMARY;

  /**
   * 工具调用摘要列表
   */
  summaries: ToolUseSummary[];

  /**
   * 创建时间
   */
  createdAt: Date;

  /**
   * 会话ID
   */
  sessionId?: string;

  /**
   * 元数据
   */
  metadata?: Record<string, unknown>;
}

/**
 * 附件消息接口
 */
export interface AttachmentMessage {
  /**
   * 消息ID
   */
  id: string;

  /**
   * 消息类型
   */
  type: MessageType.ATTACHMENT;

  /**
   * 消息角色
   */
  role: MessageRole;

  /**
   * 附件列表
   */
  attachments: MessageAttachment[];

  /**
   * 附件描述文本
   */
  description?: string;

  /**
   * 创建时间
   */
  createdAt: Date;

  /**
   * 更新时间
   */
  updatedAt: Date;

  /**
   * 会话ID
   */
  sessionId?: string;

  /**
   * 元数据
   */
  metadata?: Record<string, unknown>;
}
