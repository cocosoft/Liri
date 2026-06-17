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
 * Agent 事件类型枚举
 * 对标 AgentScope EventType (20+ 事件类型)
 * 覆盖 Agent 执行全生命周期
 */

// ========== 共享类型（从 index.ts 提取，解决与 SSEEncoder 的循环依赖） ==========

export type EventPriority = 'low' | 'normal' | 'high';

export interface AgentEvent {
  id: string;
  type: string;
  source: string;
  target?: string;
  data?: unknown;
  priority: EventPriority;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface EventHandler {
  (event: AgentEvent): Promise<void> | void;
}

export interface EventSubscription {
  id: string;
  type: string | '*';
  handler: EventHandler;
  priority: EventPriority;
  once: boolean;
}

export interface EventStats {
  totalEmitted: number;
  totalHandled: number;
  activeSubscriptions: number;
  eventsByType: Record<string, number>;
}

export enum AgentEventType {
  // ========== 回复生命周期 ==========

  /** AI 开始生成回复 */
  REPLY_START = 'agent:reply:start',
  /** AI 回复增量块 */
  REPLY_DELTA = 'agent:reply:delta',
  /** AI 回复结束 */
  REPLY_END = 'agent:reply:end',
  /** AI 回复出错 */
  REPLY_ERROR = 'agent:reply:error',
  /** AI 回复被中断 */
  REPLY_INTERRUPT = 'agent:reply:interrupt',

  // ========== 思考阶段 ==========

  /** Agent 开始思考 */
  THINKING_START = 'agent:thinking:start',
  /** Agent 思考增量 */
  THINKING_DELTA = 'agent:thinking:delta',
  /** Agent 思考结束 */
  THINKING_END = 'agent:thinking:end',

  // ========== 工具调用 ==========

  /** 模型请求工具调用 */
  TOOL_CALLS = 'agent:tool:calls',
  /** 单个工具开始执行 */
  TOOL_CALL_START = 'agent:tool:call:start',
  /** 工具执行增量输出 */
  TOOL_CALL_DELTA = 'agent:tool:call:delta',
  /** 单个工具执行结束 */
  TOOL_CALL_END = 'agent:tool:call:end',
  /** 所有工具结果返回 */
  TOOL_RESULTS = 'agent:tool:results',
  /** 工具执行出错 */
  TOOL_ERROR = 'agent:tool:error',

  // ========== 上下文管理 ==========

  /** 开始上下文压缩 */
  CONTEXT_COMPRESSING = 'agent:context:compressing',
  /** 上下文压缩完成 */
  CONTEXT_COMPRESSED = 'agent:context:compressed',

  // ========== Agent 执行生命周期 ==========

  /** Agent 开始执行任务 */
  EXECUTE_START = 'agent:execute:start',
  /** Agent 任务执行完成 */
  EXECUTE_END = 'agent:execute:end',
  /** Agent 任务执行出错 */
  EXECUTE_ERROR = 'agent:execute:error',

  // ========== 外部执行 ==========

  /** 请求外部执行确认 */
  EXTERNAL_EXECUTION = 'agent:external:execution',
  /** 外部执行结果返回 */
  EXTERNAL_EXECUTION_RESULT = 'agent:external:execution:result',

  // ========== 权限 ==========

  /** 权限检查 */
  PERMISSION_CHECK = 'agent:permission:check',
  /** 权限决策结果 */
  PERMISSION_DECISION = 'agent:permission:decision',

  // ========== 内存与状态 ==========

  /** Agent 状态变更 */
  STATE_CHANGE = 'agent:state:change',
  /** Agent 内存更新 */
  MEMORY_UPDATE = 'agent:memory:update',
}
