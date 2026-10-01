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

// H5-② 收口（台账 D-203）：`AgentEventType` 定义已下沉至 core 层 types 模块的 `agentEvents`，
// 此处仅**转出**（对外导出名与成员逐字不变）。
// 原因：`infrastructure/http/handlers/` 下 2 个文件（orchestration-handlers /
// OrchestrationHistoryAdapter）需要其枚举值作事件白名单，而 service 不得依赖 app 层
// ⇒ 定义归 core，app 层转出（同 D-67 的 `OrchestrationEventType` 手法）。
// 载荷接口（`AgentEvent` / `EventHandler` 等）**仍留在本文件**（app 层领域载荷）。
export { AgentEventType } from '@modules/types/agentEvents';
