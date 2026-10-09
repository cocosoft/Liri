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
 * 消息模型 —— 枚举与基础类型（C3 拆分，2026-10-09）
 *
 * 自 `session/types/message.ts` 拆出（R04-001 尺寸债治理）。拆分**只搬位置、不改语义**：
 * 对外 API 由 `session/types/message.ts`（barrel）原样重导出 ⇒ 既有 import 零改动。
 */

import type { Message } from '../message';

/**
 * 消息角色
 *
 * @see {@link DataMessageRole}（协议/存储向模型；与领域模型形状不等价，勿直接互换）
 */
export enum MessageRole {
  /**
   * 用户
   */
  USER = 'user',

  /**
   * 助手
   */
  ASSISTANT = 'assistant',

  /**
   * 工具
   */
  TOOL = 'tool',

  /**
   * 系统
   */
  SYSTEM = 'system',
}

/**
 * 消息类型枚举
 *
 * @see {@link DataMessageType}（协议/存储向模型；与领域模型形状不等价，勿直接互换）
 */
export enum MessageType {
  /**
   * 普通消息
   */
  NORMAL = 'normal',

  /**
   * 压缩边界消息
   */
  COMPACT_BOUNDARY = 'compact_boundary',

  /**
   * 工具调用摘要消息
   */
  TOOL_USE_SUMMARY = 'tool_use_summary',

  /**
   * 附件消息
   */
  ATTACHMENT = 'attachment',

  /**
   * 系统消息
   */
  SYSTEM = 'system',
}

/**
 * 消息状态枚举
 *
 * @see {@link DataMessageStatus} 或自行定义 （协议/存储向模型；与领域模型形状不等价，勿直接互换）
 */
export enum MessageStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELED = 'canceled',
}

/**
 * 消息优先级枚举
 */
export enum MessagePriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * 消息附件类型
 */
export type AttachmentType =
  | 'image'
  | 'file'
  | 'audio'
  | 'video'
  | 'document'
  | 'link'
  | 'code'
  | 'table'
  | 'chart';

/**
 * 消息附件
 *
 * @see {@link DataAttachment}（协议/存储向模型；与领域模型形状不等价，勿直接互换）
 */
export interface MessageAttachment {
  id: string;
  type: AttachmentType;
  name: string;
  url?: string;
  data?: string;
  size?: number;
  contentType?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 消息分类
 */
export type MessageCategory =
  | 'conversation'
  | 'system'
  | 'tool'
  | 'notification'
  | 'error'
  | 'debug'
  | 'analytics';

export type UserMessage = Message;
export type AssistantMessage = Message;
export type SystemMessage = Message;
