/**
 * PluginStateMapper — 三套插件状态机互映射 + PENDING 定义（报告 4.4）
 *
 * 背景：代码存在三套并存的状态机，相互之间无映射函数：
 * - PluginState 8 态（管理基础设施视角）—— plugins/types/PluginTypes.ts
 * - PluginStatus 5 态（插件开发者视角）—— plugins/types/Plugin.ts
 * - PluginRuntimeStatus 6 态（plugin-sdk 运行时视角）—— plugin-sdk/types.ts
 *
 * 设计决策：
 * 1. 不修改三套现有枚举值（避免破坏既有消费方）；
 * 2. 新增统一的 PENDING 常量，作为扩展联合类型参与映射（响应式加载的挂起状态）；
 * 3. ACTIVATED（PluginState）与 ENABLED（PluginStatus）语义重叠：二者均视为「已启用/激活」。
 */

import { PluginState } from '../types/PluginTypes';
import { PluginStatus } from '../types/Plugin';
import type { PluginRuntimeStatus } from '../../plugin-sdk/types';

/** 统一挂起状态（响应式加载：inject 声明服务缺失，等待服务注册后激活） */
export const PLUGIN_PENDING_STATE = 'pending' as const;
export type PluginPendingState = typeof PLUGIN_PENDING_STATE;

/** 可含 PENDING 的状态联合 */
export type AnyPluginState =
  | PluginState
  | PluginStatus
  | PluginRuntimeStatus
  | PluginPendingState;

/** PluginState → PluginStatus */
const STATE_TO_STATUS: Record<PluginState, PluginStatus> = {
  [PluginState.UNLOADED]: PluginStatus.REGISTERED,
  [PluginState.LOADING]: PluginStatus.LOADED,
  [PluginState.LOADED]: PluginStatus.LOADED,
  [PluginState.ACTIVATED]: PluginStatus.ENABLED,
  [PluginState.DEACTIVATED]: PluginStatus.DISABLED,
  [PluginState.FAILED]: PluginStatus.ERROR,
  [PluginState.DISABLED]: PluginStatus.DISABLED,
  [PluginState.ENABLED]: PluginStatus.ENABLED,
};

/** PluginStatus → PluginRuntimeStatus */
const STATUS_TO_RUNTIME: Record<PluginStatus, PluginRuntimeStatus> = {
  [PluginStatus.REGISTERED]: 'created' as PluginRuntimeStatus,
  [PluginStatus.LOADED]: 'inactive' as PluginRuntimeStatus,
  [PluginStatus.ENABLED]: 'active' as PluginRuntimeStatus,
  [PluginStatus.DISABLED]: 'inactive' as PluginRuntimeStatus,
  [PluginStatus.ERROR]: 'error' as PluginRuntimeStatus,
};

/** PluginRuntimeStatus → PluginState */
const RUNTIME_TO_STATE: Record<PluginRuntimeStatus, PluginState> = {
  created: PluginState.UNLOADED,
  initializing: PluginState.LOADING,
  active: PluginState.ACTIVATED,
  deactivating: PluginState.DEACTIVATED,
  inactive: PluginState.DEACTIVATED,
  error: PluginState.FAILED,
};

/**
 * 管理视角状态 → 开发者视角状态
 * PENDING 透传（开发者视角同样处于挂起等待）。
 */
export function mapPluginStateToStatus(
  state: PluginState | PluginPendingState
): PluginStatus | PluginPendingState {
  if (state === PLUGIN_PENDING_STATE) return PLUGIN_PENDING_STATE;
  return STATE_TO_STATUS[state];
}

/**
 * 开发者视角状态 → SDK 运行时状态
 * PENDING 透传（SDK 运行时同样处于挂起等待）。
 */
export function mapPluginStatusToRuntime(
  status: PluginStatus | PluginPendingState
): PluginRuntimeStatus | PluginPendingState {
  if (status === PLUGIN_PENDING_STATE) return PLUGIN_PENDING_STATE;
  return STATUS_TO_RUNTIME[status];
}

/**
 * SDK 运行时状态 → 管理视角状态
 * PENDING 透传。
 */
export function mapPluginRuntimeToState(
  runtime: PluginRuntimeStatus | PluginPendingState
): PluginState | PluginPendingState {
  if (runtime === PLUGIN_PENDING_STATE) return PLUGIN_PENDING_STATE;
  return RUNTIME_TO_STATE[runtime];
}

/**
 * 三套状态机的一站式互转（含 PENDING 透传）
 */
export function mapPluginState(
  state: AnyPluginState,
  target: 'status' | 'runtime' | 'state'
): AnyPluginState {
  if (state === PLUGIN_PENDING_STATE) return PLUGIN_PENDING_STATE;

  if (target === 'status') {
    // 输入可能是 PluginState 或 PluginRuntimeStatus
    if (state in STATE_TO_STATUS) {
      return STATE_TO_STATUS[state as PluginState];
    }
    const asState = RUNTIME_TO_STATE[state as PluginRuntimeStatus];
    return STATE_TO_STATUS[asState];
  }

  if (target === 'runtime') {
    if (state in STATUS_TO_RUNTIME) {
      return STATUS_TO_RUNTIME[state as PluginStatus];
    }
    if (state in STATE_TO_STATUS) {
      return STATUS_TO_RUNTIME[STATE_TO_STATUS[state as PluginState]];
    }
    return state as PluginRuntimeStatus;
  }

  // target === 'state'：归一到 PluginState
  if (state in STATE_TO_STATUS) return state as PluginState;
  if (state in STATUS_TO_RUNTIME) {
    return RUNTIME_TO_STATE[STATUS_TO_RUNTIME[state as PluginStatus]];
  }
  return state as PluginState;
}
