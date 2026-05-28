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
 * SDK runtime — 插件运行时
 *
 * 包含插件的生命周期管理、钩子系统和事件系统。
 * 运行时模块负责插件的加载、激活、停用等生命周期管理。
 */

// 钩子系统
export { PluginHooks, pluginHooks } from '../../hooks/PluginHooks';
export type {
  HookType,
  HookStage,
  HookContext,
  HookFunction,
  HookResult,
  HookRegistration,
} from '../../hooks/PluginHooks';

export { GlobalRunner, globalRunner } from '../../hooks/GlobalRunner';
export type {
  GlobalRunnerStrategy,
  GlobalHookFilter,
  GlobalRunResult,
} from '../../hooks/GlobalRunner';

export { HostHooks, hostHooks } from '../../hooks/HostHooks';
export type {
  HostHookType,
  HostHookContext,
  HostHookFunction,
  HostHookResult,
  HostHookRegistration,
} from '../../hooks/HostHooks';

export { PhaseHooks, phaseHooks } from '../../hooks/PhaseHooks';
export type {
  PhaseName,
  PhaseHookContext,
  PhaseHookFunction,
  PhaseHookResult,
  PhaseHookRegistration,
  PhaseExecutionRecord,
} from '../../hooks/PhaseHooks';

// 生命周期管理（状态机风格）
export {
  PluginLifecycleManager,
  pluginLifecycleManager,
} from '../../lifecycle/PluginLifecycleManager';
export type {
  PluginState,
  LifecycleConfig,
} from '../../lifecycle/PluginLifecycleManager';

// 生命周期事件类型（EventEmitter 风格）
export { PluginLifecycleEvent } from '../../core/PluginLifecycleManager';
export type {
  LifecycleHook,
  LifecycleContext,
} from '../../core/PluginLifecycleManager';

// PluginSDK 运行时
export { PluginSDK, createPluginSDK } from '../../../core/PluginSDK';
