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
 * 消息模型（会话消息事实规范；C3 拆分后的 **barrel + 核心模型**，2026-10-09）
 *
 * R04-001 尺寸债治理：原单文件 1280 行，按**内聚**拆为：
 * - `./message/enums.ts`      —— 角色/类型/状态/优先级/附件类型/分类 + 消息别名
 * - `./message/blocks.ts`     —— 内容块 / 压缩边界 / 工具摘要 / 附件消息
 * - `./message/options.ts`    —— 收发选项（Send/Stream/Options）与创建参数
 * - `./message/factories.ts`  —— 工厂与工具函数（create / generate / normalize 系列）
 *
 * **本文件是对外唯一入口**（`@modules/session/types/message`）：保持 `Message` 定义在
 * 规范路径（R05-011 口径），并 `export *` 重导出上述子模块 ⇒ **既有 import 零改动**。
 */

// ─── 子模块原样重导出（保持对外 API 不变）───
export * from './message/enums';
export * from './message/blocks';
export * from './message/options';
export * from './message/factories';

import type {
  CompactBoundaryType,
  ContentBlock,
  ToolUseSummary,
} from './message/blocks';
import type {
  MessageAttachment,
  MessageCategory,
  MessagePriority,
  MessageRole,
  MessageStatus,
  MessageType,
} from './message/enums';

/**
 * 消息接口
 *
 * @see {@link DataMessage}（协议/存储向模型；与领域模型形状不等价，勿直接互换）
 */
export interface Message {
  /**
   * 消息ID
   */
  id: string;

  /**
   * 消息角色
   */
  role: MessageRole;

  /**
   * 消息类型
   */
  type?: MessageType;

  /**
   * 消息内容
   */
  content: string | ContentBlock[];

  /**
   * 创建时间
   */
  createdAt: Date;

  /**
   * 流式开始时间（1.6：与 createdAt 完成时间区分，用于导出显示开始时间与耗时）
   */
  startedAt?: Date;

  /**
   * 更新时间
   */
  updatedAt: Date;

  /**
   * 工具调用ID（仅适用于工具结果消息）
   */
  toolCallId?: string;

  /**
   * 工具调用列表（仅适用于助手消息，表示 LLM 发起工具调用）
   */
  tool_calls?: Array<Record<string, unknown>>;

  /**
   * 前端消息块结构（用于分组渲染 text/thinking/tool_call/status）
   */
  blocks?: Array<Record<string, unknown>>;

  /**
   * 会话ID
   */
  sessionId?: string;

  /**
   * 元数据
   */
  metadata?: Record<string, unknown>;

  /**
   * 投影版本戳（P1-6/G8/N11）：写盘时刻的会话全局事件 seq，随消息对象常驻以过 compact
   */
  lastEventSeq?: number;

  /**
   * 消息状态
   */
  status?: MessageStatus;

  /**
   * 消息优先级
   */
  priority?: MessagePriority;

  /**
   * 消息分类
   */
  category?: MessageCategory;

  /**
   * 消息附件
   */
  attachments?: MessageAttachment[];

  /**
   * 父消息ID
   */
  parentId?: string;

  /**
   * 线程ID
   */
  threadId?: string;

  /**
   * 处理时间
   */
  processingTime?: number;

  /**
   * 错误详情
   */
  errorDetails?: Record<string, unknown>;

  /**
   * 相关消息ID
   */
  relatedMessageId?: string;

  /**
   * 压缩边界消息（当类型为COMPACT_BOUNDARY时使用）
   */
  boundaryType?: CompactBoundaryType;

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
   * 上下文摘要
   */
  contextSummary?: string;

  /**
   * 工具调用摘要列表
   */
  toolUseSummaries?: ToolUseSummary[];

  /**
   * 是否为元消息（用于辅助标记，不计入正常消息流）
   */
  isMeta?: boolean;

  /**
   * 是否为压缩摘要消息
   */
  isCompactSummary?: boolean;

  /**
   * 消息子类型（用于扩展消息分类，如 'away_summary'、'compact_boundary' 等）
   */
  subtype?: string;

  /**
   * 流式响应结束原因（'stop' | 'length' | 'error'），仅助手消息
   */
  finishReason?: string;
}

/**
 * 规范化消息接口
 */
export interface NormalizedMessage extends Message {
  /**
   * 规范化的内容
   */
  normalizedContent: string;

  /**
   * 消息长度
   */
  length: number;

  /**
   * 是否包含工具调用
   */
  hasToolCalls: boolean;

  /**
   * 是否包含工具结果
   */
  hasToolResults: boolean;
}

/**
 * Token 用量信息
 */
export interface UsageInfo {
  /** 输入词元数 */
  inputTokens: number;

  /** 输出词元数 */
  outputTokens: number;

  /** 缓存读取词元数 */
  cacheReadInputTokens?: number;

  /** 缓存创建词元数 */
  cacheCreationInputTokens?: number;

  /** 总词元数 */
  totalTokens: number;

  /** 估算成本（美元） */
  estimatedCostUsd?: number;
}

/**
 * 工具调用事件详情（结构化对象，替代原截断 200 字符的 JSON 字符串）
 * - start：args 携带完整参数对象（不再截断，避免 CoreAPIImpl JSON.parse 失败）
 * - end：ok 成功标志 + message 摘要文本 + result 原始结果（供文件路径提取等）
 */
export interface ToolCallEventDetail {
  /** start: 工具参数对象（完整，不截断） */
  args?: Record<string, unknown>;
  /** end: 是否执行成功（error 为空即成功） */
  ok?: boolean;
  /** end: 摘要文本（成功/失败/错误消息） */
  message?: string;
  /** end: 原始执行结果（类型 unknown，供 file 路径提取等） */
  result?: unknown;
}

/**
 * 聊天响应
 */
export interface ChatResponse {
  /**
   * 消息
   */
  message: Message;

  /**
   * 工具调用列表
   */
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;

  /**
   * token使用情况
   */
  usage?: {
    /**
     * 输入token数
     */
    inputTokens: number;

    /**
     * 输出token数
     */
    outputTokens: number;

    /**
     * 总token数
     */
    totalTokens: number;
  };

  /**
   * 模型名称
   */
  model?: string;

  /**
   * 完成原因
   */
  finishReason?: string;
}

/**
 * 流数据块
 */
export interface StreamChunk {
  /**
   * 内容
   */
  content: string;

  /**
   * 完成标志
   */
  isComplete: boolean;

  /**
   * token使用情况
   */
  usage?: {
    /**
     * 输入token数
     */
    inputTokens: number;

    /**
     * 输出token数
     */
    outputTokens: number;

    /**
     * 总token数
     */
    totalTokens: number;
  };

  /**
   * 模型名称
   */
  model?: string;

  /**
   * 完成原因
   */
  finishReason?: string;
}
