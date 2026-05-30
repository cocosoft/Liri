/**
 * ModuleBridgeInit — ACP 模块桥接初始化
 *
 * 负责创建 ModuleBridgeRuntime 实例并注册到 AcpRuntimeRegistry。
 * 供应用启动流程调用，完成模块操作能力的 ACP 暴露。
 */

import { getAcpRuntimeRegistry } from '../acp/runtime/registry.js';
import {
  ModuleBridgeRuntime,
  setDefaultModuleBridge,
  type ModuleBridgeDependencies,
} from './ModuleBridgeRuntime.js';

export interface ModuleBridgeInitConfig {
  id?: string;
  name?: string;
  priority?: number;
}

const DEFAULT_CONFIG: Required<ModuleBridgeInitConfig> = {
  id: 'module-bridge',
  name: 'Module Bridge Runtime',
  priority: 100,
};

/**
 * 初始化 ACP 模块桥接
 *
 * 创建 ModuleBridgeRuntime 实例，注入依赖模块，注册到 AcpRuntimeRegistry。
 *
 * @param deps - 模块依赖（TaskRegistry、DaemonService、ChronosScheduler）
 * @param config - 注册配置（id、name、priority）
 * @returns 创建的 ModuleBridgeRuntime 实例
 */
export function initModuleBridge(
  deps: ModuleBridgeDependencies,
  config: ModuleBridgeInitConfig = {}
): ModuleBridgeRuntime {
  const { id, name, priority } = { ...DEFAULT_CONFIG, ...config };

  const runtime = new ModuleBridgeRuntime(deps);
  setDefaultModuleBridge(runtime);

  const registry = getAcpRuntimeRegistry();
  registry.register({ id, name, runtime, priority });

  return runtime;
}
