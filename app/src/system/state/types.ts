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

import type { Store } from './Store.js';

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
 * 使用核心任务模块的类型定义
 */
export interface TaskState {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'killed';
  description: string;
  toolUseId?: string;
  startTime: number;
  endTime?: number;
  totalPausedMs?: number;
  outputFile: string;
  outputOffset: number;
  notified: boolean;
  result?: unknown;
  error?: string;
}

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
 * 应用状态接口
 */
export interface AppState {
  settings: Record<string, unknown>;
  verbose: boolean;
  statusLineText?: string;
  expandedView: 'none' | 'tasks' | 'settings';
  isBriefOnly: boolean;
  toolPermissionContext: ToolPermissionContext;
  denialTracking: DenialTrackingState;
  mcp: MCPState;
  plugins: PluginLoadState;
  tasks: { [taskId: string]: TaskState };
  notifications: Notification[];
  notificationCount: number;
  sandboxEnabled: boolean;
  remoteSessionUrl?: string;
  remoteConnectionStatus?:
    | 'connecting'
    | 'connected'
    | 'reconnecting'
    | 'disconnected';
  startupTime: number;
}

/**
 * 创建默认应用状态
 * @returns 默认应用状态
 */
export function createDefaultAppState(): AppState {
  return {
    settings: {},
    verbose: false,
    statusLineText: undefined,
    expandedView: 'none',
    isBriefOnly: false,
    toolPermissionContext: {
      mode: 'default',
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
    },
    denialTracking: {
      consecutiveDenials: 0,
      totalDenials: 0,
    },
    mcp: {
      clients: [],
      tools: [],
      commands: [],
      pluginReconnectKey: 0,
    },
    plugins: {
      enabled: [],
      disabled: [],
      errors: [],
    },
    tasks: {},
    notifications: [],
    notificationCount: 0,
    sandboxEnabled: true,
    remoteSessionUrl: undefined,
    remoteConnectionStatus: undefined,
    startupTime: Date.now(),
  };
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

/**
 * AppState存储接口
 */
export interface AppStateStore {
  store: Store<AppState>;
  getState: () => AppState;
  setState: (updater: (prev: AppState) => AppState) => void;
  subscribe: (listener: (state: AppState) => void) => () => void;
  updateToolPermissionContext: (
    context: Partial<ToolPermissionContext>
  ) => void;
  addNotification: (
    notification: Omit<Notification, 'id' | 'timestamp'>
  ) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
  updateDenialTracking: (state: Partial<DenialTrackingState>) => void;
  resetDenialTracking: () => void;
}
