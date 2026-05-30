/**
 * ModuleBridgeSetup — ACP 模块桥接启动设置
 *
 * 在应用启动时被调用，动态发现可用的模块依赖并初始化桥接运行时。
 * 各依赖均为可选，缺失的模块在命令执行时会返回"未接入"提示。
 *
 * 桥接初始化完成后，可选启动 ACP 远程 WebSocket 网络服务，使外部
 * ACP 客户端可以通过网络连接进行任务管理和模块查询。
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger.js';
import { initModuleBridge } from './ModuleBridgeInit.js';
import { createAcpWebSocketServer } from '@modules/acp/server.js';
import type { ModuleBridgeDependencies } from './ModuleBridgeRuntime.js';
import type { AcpWebSocketServerConfig } from '@modules/acp/types.js';
import type { AcpRuntime } from '@modules/acp/runtime/types.js';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 从环境变量中读取 ACP WebSocket 服务器配置
 *
 * - ACP_REMOTE_HOST: 监听地址，默认 127.0.0.1
 * - ACP_REMOTE_PORT: 监听端口，未设置或为 0 表示禁用远程服务
 * - ACP_REMOTE_AUTH_TOKEN: 可选的 Bearer 认证 Token
 */
function resolveAcpRemoteConfig(): AcpWebSocketServerConfig | null {
  const portStr = process.env.ACP_REMOTE_PORT || '';
  const port = parseInt(portStr, 10);

  if (!portStr || isNaN(port) || port <= 0) {
    return null;
  }

  return {
    host: process.env.ACP_REMOTE_HOST || '127.0.0.1',
    port,
    path: process.env.ACP_REMOTE_PATH || '/acp',
    authToken: process.env.ACP_REMOTE_AUTH_TOKEN || undefined,
    maxMessageSize: 1 * 1024 * 1024,
  };
}

/**
 * 启动时设置模块桥接
 *
 * 尝试动态导入 TaskRegistry 等模块，将可用依赖注入 ModuleBridgeRuntime。
 * 目前通过动态导入自动发现：
 *   - TaskRegistry（单例，始终可用）
 *
 * 桥接初始化后，若配置了 ACP_REMOTE_PORT 环境变量，则自动启动
 * ACP 远程 WebSocket 网络服务，使外部客户端可通过网络调用模块能力。
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

  let bridge: AcpRuntime;

  try {
    bridge = initModuleBridge(deps, {
      id: 'module-bridge',
      name: 'Module Bridge Runtime',
      priority: 100,
    });
    logger.info('[Bridge] ACP 模块桥接初始化完成');
  } catch (error) {
    logger.error('[Bridge] ACP 模块桥接初始化失败', error as Error);
    return;
  }

  await startAcpRemoteServer(bridge);
}

/**
 * 根据环境变量配置启动 ACP 远程 WebSocket 服务器
 */
async function startAcpRemoteServer(runtime: AcpRuntime): Promise<void> {
  const config = resolveAcpRemoteConfig();

  if (!config) {
    logger.info('[Bridge] ACP 远程服务未启用（设置 ACP_REMOTE_PORT 以启用）');
    return;
  }

  try {
    const server = createAcpWebSocketServer(runtime, config);
    await server.start();

    logger.info(
      `[Bridge] ACP 远程 WebSocket 服务已启动: ws://${config.host}:${config.port}${config.path}`
    );
  } catch (error) {
    logger.error('[Bridge] ACP 远程 WebSocket 服务启动失败', error as Error);
  }
}
