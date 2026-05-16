#!/usr/bin/env bun

import { profileCheckpoint, profileReport } from './utils/startupProfiler';
import { Logger } from './monitoring/logs/Logger';
import {
  startMdmPrefetch,
  ensureMdmPrefetchCompleted,
} from './infrastructure/startup/MdmPrefetch';
import {
  startKeychainPrefetch,
  ensureKeychainPrefetchCompleted,
} from './infrastructure/startup/KeychainPrefetch';

const logger = new Logger({ level: 'info' as any });

/**
 * 启动模式枚举
 */
export enum LaunchMode {
  CLI = 'cli',
  REPL = 'repl',
  MCP = 'mcp',
  DAEMON = 'daemon',
  TEST = 'test',
}

/**
 * 启动选项
 */
export interface LaunchOptions {
  mode: LaunchMode;
  args?: string[];
  debug?: boolean;
  verbose?: boolean;
}

function setupWindowsSecurity(): void {
  if (process.platform === 'win32') {
    process.env.NoDefaultCurrentDirectoryInExePath = '1';
  }
}

/**
 * 初始化模块系统
 */
async function initializeModuleSystem(): Promise<void> {
  try {
    const { quickInitialize } = await import('./modules/index');
    await quickInitialize();
    logger.info('模块系统初始化完成');
  } catch (error) {
    logger.error('模块系统初始化失败', error as Error);
    throw error;
  }
}

/**
 * 启动 CLI 模式
 */
async function launchCLI(options: LaunchOptions): Promise<void> {
  const { init } = await import('./entrypoints/init');
  await init();

  const { main } = await import('./entrypoints/cli');
  await main();
}

/**
 * 启动 REPL 模式
 */
async function launchREPL(options: LaunchOptions): Promise<void> {
  const { init } = await import('./entrypoints/init');
  await init();

  // 禁用 Gateway（避免 WebSocket 端口冲突）
  try {
    const { configManager } = await import('./cli/config');
    const gatewayConfig = configManager.getGatewayConfig();
    gatewayConfig.enabled = false;
    gatewayConfig.websocket.enabled = false;
  } catch {
    // 忽略
  }

  // 解析 --http-port 参数
  const httpPort = parseHttpPortFromArgs(options.args);

  const { launchRepl } = await import('./entrypoints/repl');
  await launchRepl({ httpPort });
}

/**
 * 从命令行参数中解析 --http-port 值
 */
function parseHttpPortFromArgs(args?: string[]): number | undefined {
  if (!args) return undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--http-port' && i + 1 < args.length) {
      const port = parseInt(args[i + 1], 10);
      if (!isNaN(port) && port > 0 && port < 65536) {
        return port;
      }
    }
    if (args[i].startsWith('--http-port=')) {
      const port = parseInt(args[i].split('=')[1], 10);
      if (!isNaN(port) && port > 0 && port < 65536) {
        return port;
      }
    }
  }

  return undefined;
}

/**
 * 启动 MCP 服务器模式
 */
async function launchMCPServer(options: LaunchOptions): Promise<void> {
  const { init } = await import('./entrypoints/init');
  await init();

  const { startMCPServer } = await import('./entrypoints/mcp');
  await startMCPServer(
    process.cwd(),
    options.debug ?? false,
    options.verbose ?? false
  );
}

/**
 * 启动后台守护进程模式
 */
async function launchDaemon(options: LaunchOptions): Promise<void> {
  const { init } = await import('./entrypoints/init');
  await init();

  logger.info('后台守护进程模式启动（当前复用 REPL 模式）');
  const { launchRepl } = await import('./entrypoints/repl');
  await launchRepl();
}

/**
 * 启动测试模式
 */
async function launchTest(options: LaunchOptions): Promise<void> {
  const { init } = await import('./entrypoints/init');
  await init();

  logger.info('测试模式启动');
}

/**
 * 统一应用启动入口
 *
 * 根据指定的启动模式，执行环境检测、配置加载、模块系统初始化，
 * 然后分发到对应的模式处理器。
 */
export async function launch(options: LaunchOptions): Promise<void> {
  setupWindowsSecurity();

  profileCheckpoint('launch_start');

  try {
    logger.info(`应用启动 - 模式: ${options.mode}`);

    // T0: 启动并行预读取（不阻塞模块初始化）
    profileCheckpoint('T0_preroll_start');
    startMdmPrefetch();
    if (process.platform === 'darwin') {
      startKeychainPrefetch(
        ['PY_APP', 'com.pyapp.api-key'],
        process.env.USER || ''
      );
    }
    profileCheckpoint('T0_preroll_end');

    // 模块系统初始化
    profileCheckpoint('module_init_start');
    await initializeModuleSystem();
    profileCheckpoint('module_init_end');

    // T1: 等待关键预读取完成
    profileCheckpoint('T1_await_prefetch_start');
    await ensureMdmPrefetchCompleted();
    if (process.platform === 'darwin') {
      await ensureKeychainPrefetchCompleted();
    }
    profileCheckpoint('T1_await_prefetch_end');

    // T2: 模式分发
    profileCheckpoint('T2_dispatch_start');
    switch (options.mode) {
      case LaunchMode.CLI:
        await launchCLI(options);
        break;
      case LaunchMode.REPL:
        await launchREPL(options);
        break;
      case LaunchMode.MCP:
        await launchMCPServer(options);
        break;
      case LaunchMode.DAEMON:
        await launchDaemon(options);
        break;
      case LaunchMode.TEST:
        await launchTest(options);
        break;
      default:
        logger.warning(`未知启动模式: ${options.mode}，使用 REPL 模式`);
        await launchREPL(options);
        break;
    }
    profileCheckpoint('T2_dispatch_end');

    profileReport();
  } catch (error) {
    logger.error('应用启动失败', {
      message: error instanceof Error ? error.message : String(error),
    });
    profileCheckpoint('launch_error');
    profileReport();
    process.exit(1);
  }
}

/**
 * 默认启动函数（兼容 cli.tsx 的 import { main } from '../main'）
 */
export async function main(): Promise<void> {
  const mode = (process.argv[2] as LaunchMode) || LaunchMode.REPL;
  const args = process.argv.slice(3);
  await launch({ mode, args });
}

if (import.meta.main) {
  main();
}
