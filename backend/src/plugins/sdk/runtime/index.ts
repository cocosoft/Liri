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
export { PluginLifecycleManager, pluginLifecycleManager } from '../../lifecycle/PluginLifecycleManager';
export type { PluginState, LifecycleConfig } from '../../lifecycle/PluginLifecycleManager';

// 生命周期事件类型（EventEmitter 风格）
export { PluginLifecycleEvent } from '../../core/PluginLifecycleManager';
export type {
  LifecycleHook,
  LifecycleContext,
} from '../../core/PluginLifecycleManager';

// PluginSDK 运行时
export { PluginSDK, createPluginSDK } from '../../../core/PluginSDK';
