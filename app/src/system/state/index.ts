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
// 核心状态管理（应用状态）
export {
  appStateStore,
  createAppStateStore,
  getGlobalStore,
  initializeGlobalStore,
} from './AppStateStore';

export type {
  CompletionBoundary,
  SpeculationResult,
  SpeculationState,
  FooterItem,
  RemoteConnectionStatus,
  StateChangeListener,
  StateUpdater,
  AppState,
  Notification,
  NotificationType,
  AppStateStore,
} from './AppState';

// PYAppStateStore 增强接口（集中式状态管理）
export { createPYAppStateStore } from './PYAppStateStore';
export type {
  PYAppStateStore,
  StateChangeEvent,
  KeyPathListener,
  StateSnapshot,
  StateSnapshotMeta,
  StateTrace,
} from './PYAppStateStore';

export type {
  Store,
  StoreOptions,
  StoreMiddleware,
  Listener,
  OnChange,
} from './Store';

export { StateMigrator } from './StateMigrator';

export type {
  DenialTrackingState,
  ToolPermissionContext,
  MCPServerConnection,
  MCPState,
  PluginLoadState,
  TaskState,
  SessionId,
} from './types';
export { generateSessionId } from './types';

// Buddy/Companion 状态（从 state/ 迁移）
export {
  getDefaultAppState,
  useAppState,
  useSetAppState,
} from './buddyAppState.js';
export type { AppState as BuddyAppState } from './buddyAppState.js';
