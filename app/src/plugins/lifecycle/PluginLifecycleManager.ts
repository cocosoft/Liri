/**
 * 插件生命周期管理器（兼容层，委派至 core/PluginLifecycleManager）
 *
 * 保持与旧导入路径 @modules/plugins/lifecycle/PluginLifecycleManager 的兼容性。
 * 新代码请直接使用 @modules/plugins/core/PluginLifecycleManager。
 */

import { PluginLifecycleManager as CorePluginLifecycleManager } from '../core/PluginLifecycleManager';
import type { PluginState as CorePluginState } from '../types/PluginTypes';

// 重新导出核心类
export { PluginLifecycleManager } from '../core/PluginLifecycleManager';

// 旧版兼容类型
export interface LifecycleConfig {
  /** 超时时间(ms) */
  timeout: number;
  /** 重试次数 */
  retryCount: number;
}

/** 旧版 PluginState 别名（兼容 CodeConnect 风格状态字面量） */
export type PluginState = CorePluginState;

/** 全局单例 */
export const pluginLifecycleManager = new CorePluginLifecycleManager();
