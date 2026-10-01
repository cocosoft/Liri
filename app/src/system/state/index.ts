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
// 2026-10-01 D-164（`R00-001`）：原此处转出 `AppStateStore` / `AppState` / `PYAppStateStore`
// 三组符号 —— 该家族已**改归 app 层**（`app/src/appState/`，见
// `.trae/specs/layer-inversion-memory-chronos-system.md` §3.0）：它是 app 级状态容器，
// 消费方全为 app/entry，放在 `system`(infra) 属分层归属错误。
// **本 infra 桶不得再转出它们** —— 否则 `system` 桶转发 app 符号 ⇒ 又产生 infra→app 边。
// 需要者一律直连 `@modules/appState/…`。

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
  SessionId,
} from './types';
export { generateSystemSessionId } from './types';

// Buddy/Companion 状态（从 state/ 迁移）
export {
  getDefaultAppState,
  useAppState,
  useSetAppState,
} from './buddyAppState.js';
export type { AppState as BuddyAppState } from './buddyAppState.js';
