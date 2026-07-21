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
//
/**
 * 应用状态类型定义
 */

/**
 * 工具权限上下文
 */
export interface ToolPermissionContext {
  mode: string;
  alwaysAllowRules?: Record<string, string[]>;
  alwaysDenyRules?: Record<string, string[]>;
  alwaysAskRules?: Record<string, string[]>;
}

/**
 * 拒绝跟踪状态
 */
export interface DenialTrackingState {
  consecutiveDenials: number;
  totalDenials: number;
  lastDenialTimestamp?: number;
}

/**
 * MCP服务器连接状态
 */
export interface MCPServerConnection {
  name: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  lastError?: string;
}

/**
 * MCP状态
 */
export interface MCPState {
  clients: MCPServerConnection[];
  tools: Record<string, unknown>[];
  commands: Record<string, unknown>[];
  pluginReconnectKey: number;
}

/**
 * 插件加载状态
 */
export interface PluginLoadState {
  enabled: string[];
  disabled: string[];
  errors: string[];
}

/**
 * 任务状态
 * 规范来源: tasks/types.ts
 */
export type { TaskState } from '@modules/tasks/types';

/**
 * 通知类型
 */
export type NotificationType = 'info' | 'success' | 'warning' | 'error';

/**
 * 通知接口
 */
export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: number;
  read?: boolean;
  priority?: 'low' | 'medium' | 'high';
}

/**
 * 会话ID类型
 */
export type SessionId = string;

/**
 * 生成会话ID
 */
export function generateSessionId(): SessionId {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `sess_${timestamp}_${random}`;
}
