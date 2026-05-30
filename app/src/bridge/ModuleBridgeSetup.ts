/**
 * ModuleBridgeSetup — ACP 模块桥接启动设置
 *
 * 在应用启动时被调用，动态发现可用的模块依赖并初始化桥接运行时。
 * 各依赖均为可选，缺失的模块在命令执行时会返回"未接入"提示。
 */

import { Logger, LogLevel } from '../monitoring/logs/Logger.js';
import { initModuleBridge } from './ModuleBridgeInit.js';
import type { ModuleBridgeDependencies } from './ModuleBridgeRuntime.js';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 启动时设置模块桥接
 *
 * 尝试动态导入 TaskRegistry 等模块，将可用依赖注入 ModuleBridgeRuntime。
 * 目前通过动态导入自动发现：
 *   - TaskRegistry（单例，始终可用）
 *
 * 调用时机：模块系统初始化完成后（T1 阶段之后）。
 */
export async function setupModuleBridgeOnStartup(): Promise<void> {
  const deps: ModuleBridgeDependencies = {};

  try {
    const { taskRegistry } = await import('../tasks/TaskRegistry.js');
    deps.taskRegistry = {
      getAllTaskInfos: () => taskRegistry.getAllTaskInfos(),
      getTaskInfo: (id) => taskRegistry.getTaskInfo(id),
      getTaskCountByType: () => taskRegistry.getTaskCountByType(),
      getTaskCountByStatus: () => taskRegistry.getTaskCountByStatus(),
      kill: (id) => taskRegistry.kill(id),
      getTaskCount: () => taskRegistry.getTaskCount(),
    };
    logger.info('[Bridge] TaskRegistry 已接入');
  } catch {
    logger.info('[Bridge] TaskRegistry 暂未就绪，跳过');
  }

  try {
    initModuleBridge(deps, {
      id: 'module-bridge',
      name: 'Module Bridge Runtime',
      priority: 100,
    });
    logger.info('[Bridge] ACP 模块桥接初始化完成');
  } catch (error) {
    logger.error('[Bridge] ACP 模块桥接初始化失败', error as Error);
  }
}
