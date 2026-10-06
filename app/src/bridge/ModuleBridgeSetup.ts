/**
 * ModuleBridgeSetup — ACP 模块桥接启动设置
 *
 * 在应用启动时被调用，动态发现可用的模块依赖并初始化桥接运行时。
 * 各依赖均为可选，缺失的模块在命令执行时会返回"未接入"提示。
 *
 * 桥接初始化完成后，可选启动 ACP 远程 WebSocket 网络服务，使外部
 * ACP 客户端可以通过网络连接进行任务管理和模块查询。
 */

import { isIP } from 'node:net';
import { getLogger } from '@modules/monitoring/logs/Logger.js';
import { handleError } from '@modules/error/handleError';
import { initModuleBridge } from './ModuleBridgeInit.js';
import { createAcpWebSocketServer } from '@modules/acp';
import type { ModuleBridgeDependencies } from './ModuleBridgeRuntime.js';
import type { AcpWebSocketServerConfig } from '@modules/acp/types.js';
import { configManager } from '@modules/config';
import type { AcpRuntime } from '@modules/acp';

const logger = getLogger('bridge:moduleSetup');

/**
 * 从环境变量中读取 ACP WebSocket 服务器配置
 *
 * - ACP_REMOTE_HOST: 监听地址，默认 127.0.0.1
 * - ACP_REMOTE_PORT: 监听端口，未设置或为 0 表示禁用远程服务
 * - ACP_REMOTE_AUTH_TOKEN: Bearer 认证 Token —— **可选，但非回环监听地址下必填**
 *   （见 {@link resolveAcpRemoteRefusalReason}）
 */
function resolveAcpRemoteConfig(): AcpWebSocketServerConfig | null {
  const portStr = configManager.env('ACP_REMOTE_PORT') || '';
  const port = parseInt(portStr, 10);

  if (!portStr || isNaN(port) || port <= 0) {
    return null;
  }

  return {
    host: configManager.env('ACP_REMOTE_HOST') || '127.0.0.1',
    port,
    path: configManager.env('ACP_REMOTE_PATH') || '/acp',
    authToken: configManager.env('ACP_REMOTE_AUTH_TOKEN') || undefined,
    maxMessageSize: 1 * 1024 * 1024,
  };
}

/**
 * 监听地址是否为本机回环（`localhost` / `127.0.0.0/8` / `::1`）。
 *
 * 其它一切取值（`0.0.0.0`、`::`、局域网 IP、主机名）都视为**非回环** ——
 * 宁可误判为"对外"（触发下面的拒绝），也不放过真实暴露。
 */
function isLoopbackHost(host: string | undefined): boolean {
  // 未指定 / 空白 ⇒ `AcpWebSocketServer` 会兜底为回环（见其构造函数注释）⇒ 视为回环
  if (host === undefined) return true;
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (h === '') return true;
  if (h === 'localhost') return true;
  const ipVersion = isIP(h);
  if (ipVersion === 6) return h === '::1';
  if (ipVersion === 4) return h.startsWith('127.');
  return false;
}

/**
 * ACP 远程暴露的 fail-closed 判据（**纯函数**，便于单测）。
 *
 * 背景（台账 **N-81**，2026-10-06 用户裁定）：`AcpWebSocketServerConfig.authToken` 本就是**可选**
 * —— 其免认证取向是"**本机信任基线**"（与 `LocalHTTPService` 一致，也刻意区别于 A2A 对外面的
 * "专用密钥 + fail-closed"）。但该基线成立的前提是**只监听本机**；一旦经 `ACP_REMOTE_HOST`
 * 显式放开到非回环地址，前提即失效 —— 此时若无 token，即可被**无鉴权**连接。
 *
 * ⇒ 本判据：**非回环 且 无 token ⇒ 拒绝启动**（不以"能连上但无鉴权"的形态暴露）。
 *
 * @returns `null` = 允许启动；否则为**拒绝原因**（供日志与单测断言）
 */
export function resolveAcpRemoteRefusalReason(config: {
  host?: string;
  authToken?: string;
}): string | null {
  if (isLoopbackHost(config.host)) return null;
  if (config.authToken?.trim()) return null;
  return (
    `监听地址 ${config.host} 非本机回环，且未配置 ACP_REMOTE_AUTH_TOKEN —— ` +
    'ACP 的免认证仅适用于回环地址；请配置 token，或把 ACP_REMOTE_HOST 改回 127.0.0.1'
  );
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
    void handleError(new Error('TaskRegistry 动态导入失败'), {
      module: 'bridge:setup',
      action: 'setupModuleBridgeOnStartup.importTaskRegistry',
    });
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
    void handleError(error, {
      module: 'bridge:setup',
      action: 'initModuleBridge',
    });
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

  // N-81（2026-10-06，用户裁定「非回环 + 无 token ⇒ 拒绝启动」，fail-closed）：
  // 不以"能连上但无鉴权"的形态对外暴露；判据与背景见 resolveAcpRemoteRefusalReason。
  const refusal = resolveAcpRemoteRefusalReason(config);
  if (refusal) {
    logger.error(`[Bridge] ACP 远程服务**拒绝启动**：${refusal}`);
    return;
  }

  try {
    const server = createAcpWebSocketServer(runtime, config);
    await server.start();

    logger.info(
      `[Bridge] ACP 远程 WebSocket 服务已启动: ws://${config.host}:${config.port}${config.path}`
    );
  } catch (error) {
    void handleError(error, {
      module: 'bridge:setup',
      action: 'startAcpRemoteServer',
    });
    logger.error('[Bridge] ACP 远程 WebSocket 服务启动失败', error as Error);
  }
}
