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
 * 消息模型 —— 收发选项与创建参数（C3 拆分，2026-10-09）
 *
 * 自 `session/types/message.ts` 拆出（R04-001 尺寸债治理）。对外 API 由该 barrel 原样重导出。
 */

import type { RequestPriority } from '@modules/types/requestPriority';
import type { ContentBlock } from './blocks';
import type {
  MessageAttachment,
  MessageCategory,
  MessagePriority,
  MessageRole,
  MessageStatus,
} from './enums';
import type { Message, ToolCallEventDetail, UsageInfo } from '../message';

/**
 * 发送消息选项
 */
export interface SendMessageOptions {
  /**
   * 会话ID
   */
  sessionId?: string;

  /**
   * A5（2026-10-05）：请求优先级（跨会话资源治理用；未声明 ⇒ `interactive`）。
   * 渠道/定时/后台任务入口应显式传 `'background'`。
   */
  priority?: RequestPriority;

  /**
   * 执行标识（B-05 跨层下传，2026-10-09；`@modules/execution`）
   *
   * 由入口（如渠道 `messageRouter`）在 `ExecutionManager.acquire()` 后经
   * `ChatRequest.executionId` 透传 ⇒ `ChatManager` 按会话记录 ⇒ **工具执行器**据此
   * 在**执行每个工具之前**做 `beginToolCall` 记账；落盘失败 ⇒ **拒绝该工具**（逐工具 fail-closed）。
   */
  executionId?: string;

  /**
   * 元数据
   */
  metadata?: Record<string, unknown>;

  /**
   * 是否流式输出
   */
  stream?: boolean;

  /**
   * 前端写前落盘的消息 id（POST /v1/sessions/:id/messages 已持久化）
   * 存在时后端按 id 查重，避免流式路径重复持久化用户消息
   */
  messageId?: string;

  /**
   * 前端流式消息 id（crypto.randomUUID），P0 根治（2026-08-14）：
   * 后端 createAssistantMessage 复用它 → updateMessageBlocks(assistantId) 直接命中，
   * blocks 正常落盘，刷新后无需从 content 猜测重建。
   */
  assistantMessageId?: string;

  /**
   * 内部调用标记（系统内部发起，非用户直接输入，如计划步骤 executeStepPrompt）
   * 用于区分"用户发起 vs 系统内部"：内部调用不计入 Buddy 用户对话轮数（userSessions）
   */
  _fromInternal?: boolean;

  /**
   * 内部调用来源标识（配合 _fromInternal 调试定位）
   * 取值示例：'executeStepPrompt' | 'queryEngine' | 'fileSendToAI'
   */
  _fromInternalSource?: string;

  /**
   * 模型名称
   */
  model?: string;

  /**
   * 温度
   */
  temperature?: number;

  /**
   * Top P 核采样阈值 (0-1)
   */
  top_p?: number;

  /**
   * 最大token数
   */
  maxTokens?: number;

  /**
   * 自定义系统提示词（覆盖默认）
   */
  systemPrompt?: string;

  /**
   * 是否使用共享上下文
   * 启用后，LLM 将看到 CombinedSessionGateway 中所有通道的历史消息
   */
  useSharedContext?: boolean;

  /**
   * 工具调用事件回调
   * 在工具执行开始和结束时触发，用于在 UI 中展示工具调用过程
   * @param phase 阶段：'start' 开始执行 | 'end' 执行完成
   * @param toolName 工具名称
   * @param toolCallId 工具调用 ID
   * @param detail 结构化详情（start 携带完整参数对象 args；end 携带 ok/message/result）
   */
  onToolCall?: (
    phase: 'start' | 'end',
    toolName: string,
    toolCallId: string,
    detail?: ToolCallEventDetail
  ) => void;

  /**
   * Token 用量回调
   * 在每次 LLM 响应后触发，携带本次调用的词元用量信息
   * @param usage 词元用量信息（包含输入、输出、缓存等）
   */
  onUsage?: (usage: UsageInfo) => void;

  /**
   * 进度回调
   * 在 AI 处理的各个阶段触发，用于向调用方报告处理进度
   * @param event 包含处理阶段和人类可读描述信息的进度事件
   */
  onProgress?: (event: {
    stage: 'analyzing' | 'tool_executing' | 'generating' | 'completed';
    message: string;
    toolName?: string;
    /** 上下文水位状态（当 stage='generating' 且水位非 normal 时存在） */
    watermarkState?: {
      currentTokens: number;
      contextLimit: number;
      ratio: number;
      severity: 'normal' | 'warn' | 'compact';
    };
  }) => void;

  /**
   * 用户消息附带的图片信息
   */
  images?: Array<{ path: string; url: string; filename: string; size: number }>;
}

/**
 * 流式消息选项
 */
export interface StreamMessageOptions extends SendMessageOptions {
  /**
   * 流回调
   */
  onStream?: (chunk: string) => void;

  /**
   * 完成回调
   */
  onComplete?: (message: Message) => void;

  /**
   * 错误回调
   */
  onError?: (error: Error) => void;

  /**
   * P0-1（2026-08-26）：流中断续写——携带已生成内容，请求从断点继续而非从头重发
   */
  continueFrom?: { content: string; messageId?: string };

  /**
   * 外部取消信号（PR2，2026-10-09）
   *
   * 由调用方（如渠道 `messageRouter` 经 `CoreAPI.chatStream`）注入；在本会话的
   * `streamAbortController` 上**中继**（abort 外部 signal ⇒ abort 内部 controller），
   * 从而复用既有内部取消链路（Provider fetch / 工具执行 / Agent 桥接）实现
   * `Router → CoreAPI → ChatManager → ToolRunner → Bash/HTTP/MCP` 端到端取消。
   *
   * 内部仍持有一个独立的 session controller（`_sessionAbortControllers`）——
   * 外部 signal 只是**附加**触发源，不改写"新请求顶替旧流"的既有语义。
   */
  signal?: AbortSignal;
}

/**
 * 创建消息的参数
 */
export interface CreateMessageParams {
  /**
   * 消息角色
   */
  role: MessageRole;

  /**
   * 消息内容
   */
  content: string | ContentBlock[];

  /**
   * 自定义消息 ID（缺省时自动生成 msg-{timestamp}-{suffix}）
   * P0 根治（2026-08-14）：前端透传 assistantId，使 updateMessageBlocks 直接命中
   */
  id?: string;

  /**
   * 会话ID
   */
  sessionId?: string;

  /**
   * 工具调用ID（仅适用于工具结果消息）
   */
  toolCallId?: string;

  /**
   * 元数据
   */
  metadata?: Record<string, unknown>;

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
}
