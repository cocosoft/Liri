/**
 * State 选择器集中定义（架构优化 §6.1）
 *
 * 将所有选择器集中到一个文件，避免散落各处。
 * 基于完整的 AppState 类型（core/state/AppState.ts）定义。
 * 同时提供 Zustand 兼容 hook 和统一存储选择器。
 */

import type { AppState } from '../core/state/AppState.js';
import { useAppState as baseUseAppState, useSetAppState } from './AppState';
import {
  selectVerbose,
  selectMainLoopModel,
  selectToolPermissionContext,
  selectFooterSelection,
  selectAgent,
  selectTasks,
  selectMcpState,
  selectPlugins,
  selectSettings,
  selectRemoteConnectionStatus,
  selectRemoteSessionUrl,
  selectExpandedView,
  selectStatusLineText,
  selectKairosEnabled,
  selectReplBridgeEnabled,
  selectReplBridgeConnected,
} from './UnifiedStateStore.js';

export { useSetAppState };

/**
 * Zustand 兼容的 useAppState hook
 * 保持向后兼容，同时支持完整的 AppState 类型
 */
export function useAppState(): ReturnType<typeof baseUseAppState>;

export function useAppState<T>(selector: (state: any) => T): T;

export function useAppState<T>(selector?: (state: any) => T): T | any {
  if (selector) {
    return baseUseAppState(selector);
  }
  return baseUseAppState((s) => s);
}

// =============================================================================
// 基于完整 AppState 类型的选择器
// =============================================================================

/**
 * 详细模式选择器
 */
export { selectVerbose };

/**
 * 主循环模型选择器
 */
export { selectMainLoopModel };

/**
 * 工具权限上下文选择器
 */
export { selectToolPermissionContext };

/**
 * 权限模式选择器（从工具权限上下文派生）
 */
export const selectPermissionMode = (state: AppState) =>
  state?.toolPermissionContext?.mode;

/**
 * 底部选择选择器
 */
export { selectFooterSelection };

/**
 * 代理名称选择器
 */
export { selectAgent };

/**
 * 任务状态选择器
 */
export { selectTasks };

/**
 * MCP状态选择器
 */
export { selectMcpState };

/**
 * 插件状态选择器
 */
export { selectPlugins };

/**
 * 设置选择器
 */
export { selectSettings };

/**
 * 远程连接状态选择器
 */
export { selectRemoteConnectionStatus };

/**
 * 远程会话URL选择器
 */
export { selectRemoteSessionUrl };

/**
 * 展开视图选择器
 */
export { selectExpandedView };

/**
 * 状态栏文本选择器
 */
export { selectStatusLineText };

/**
 * Kairos启用状态选择器
 */
export { selectKairosEnabled };

/**
 * REPL桥接启用状态选择器
 */
export { selectReplBridgeEnabled };

/**
 * REPL桥接连接状态选择器
 */
export { selectReplBridgeConnected };

// =============================================================================
// 向后兼容的旧选择器（标记为已废弃）
// =============================================================================

/**
 * @deprecated 使用 selectRemoteSessionUrl 替代
 * 旧选择器引用的 sessionId 字段不存在于 AppState
 */
export const selectSessionId = (state: any) =>
  state?.replBridgeSessionId ?? state?.remoteSessionUrl;

/**
 * @deprecated 使用 selectToolPermissionContext 替代
 */
export const selectActiveTools = (state: AppState) =>
  Object.keys(state?.tasks ?? {});

/**
 * @deprecated 成本信息不在 AppState 中，需从其他模块获取
 */
export const selectCostState = (state: any) => undefined;

/**
 * @deprecated 主题信息不在 AppState 中，需从 settings 获取
 */
export const selectThemeName = (state: AppState) => state?.settings?.theme;
