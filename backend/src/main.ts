#!/usr/bin/env bun

import {
  profileCheckpoint,
  profileReport,
  profilePhaseStart,
  profilePhaseEnd,
  getPhaseSummary,
} from './utils/startupProfiler';
import { Logger } from './monitoring/logs/Logger';
import {
  startMdmPrefetch,
  ensureMdmPrefetchCompleted,
} from './infrastructure/startup/MdmPrefetch';
import {
  startKeychainPrefetch,
  ensureKeychainPrefetchCompleted,
} from './infrastructure/startup/KeychainPrefetch';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const logger = new Logger({ level: 'info' as any });

/** 首次运行标记文件 */
const ONBOARDED_FLAG = join(process.cwd(), 'backend', 'data', '.onboarded');
const ENV_FILE = join(process.cwd(), '.env');
const ENV_EXAMPLE = join(process.cwd(), '.env.example');

/** 最大首次引导重试次数 */
const MAX_ONBOARD_RETRIES = 3;

/** 引导失败重试计数文件 */
const ONBOARD_RETRY_FLAG = join(
  process.cwd(),
  'backend',
  'data',
  '.onboard_retry'
);

/** 离线模式（无 AI 密钥）标志，供 REPL 等模块使用 */
export let isOfflineMode = true;

/** 已知的占位 API 密钥值（用户未替换的真实密钥） */
const PLACEHOLDER_API_KEYS = new Set([
  'your_deepseek_api_key_here',
  'sk-your-api-key',
  'your-api-key',
  'your_api_key_here',
  '',
]);

/**
 * 校验 API 密钥是否有效（非占位符、非空）
 */
export function isValidApiKey(key: string | undefined | null): boolean {
  if (!key) return false;
  const trimmed = key.trim();
  if (trimmed.length < 8) return false; // 最短密钥长度
  if (PLACEHOLDER_API_KEYS.has(trimmed.toLowerCase())) return false;
  return true;
}

/**
 * 检查 AI 是否已配置
 */
async function isAIConfigured(): Promise<boolean> {
  try {
    if (isValidApiKey(process.env.DEEPSEEK_API_KEY)) return true;
    const { getConfig } = await import('./config/index.js');
    const config = getConfig();
    const ai = (config as Record<string, unknown>).ai as
      | Record<string, unknown>
      | undefined;
    const apiKey: string =
      ((config as Record<string, unknown>)['ai.deepseek.apiKey'] as string) ||
      ((ai?.['deepseek'] as Record<string, unknown> | undefined)?.['apiKey'] as string) ||
      '';
    return isValidApiKey(apiKey);
  } catch {
    return false;
  }
}

/**
 * 检查是否为首次运行（无配置的初始化）
 *
 * 通过检查 backend/data/.onboarded 标记文件来判断。
 * 若文件不存在，自动触发引导流程。
 */
async function checkFirstRunAndOnboard(): Promise<void> {
  if (existsSync(ONBOARDED_FLAG)) {
    // 已有标记文件，检查 AI 状态
    if (await isAIConfigured()) {
      isOfflineMode = false;
    }
    return;
  }

  // 首次运行：确保 .env 文件存在（从 .env.example 模板创建）
  if (!existsSync(ENV_FILE) && existsSync(ENV_EXAMPLE)) {
    try {
      const exampleContent = readFileSync(ENV_EXAMPLE, 'utf-8');
      // 替换占位密钥为空，引导用户填写真实密钥
      const envContent = exampleContent.replace(
        /DEEPSEEK_API_KEY=.*/,
        '# 请将下方密钥替换为你的真实 DeepSeek API 密钥\n# 获取地址: https://platform.deepseek.com/api_keys\nDEEPSEEK_API_KEY='
      );
      writeFileSync(ENV_FILE, envContent, 'utf-8');
      logger.info('.env 文件已自动创建（来自 .env.example）');
    } catch (e) {
      logger.warn('自动创建 .env 文件失败', { error: String(e) });
    }
  }

  // 检查重试次数
  let retryCount = 0;
  if (existsSync(ONBOARD_RETRY_FLAG)) {
    try {
      retryCount = parseInt(
        readFileSync(ONBOARD_RETRY_FLAG, 'utf-8').trim(),
        10
      );
    } catch {
      retryCount = 0;
    }
  }

  console.log('');
  console.log('🎉 欢迎使用 PY_APP，准备配置向导...');
  console.log('');

  if (retryCount >= MAX_ONBOARD_RETRIES) {
    console.log('  ⚠️ 引导已重试多次，跳过自动引导。');
    console.log('  您可以随时输入 /onboard 手动启动配置。');
    console.log('');
    const dataDir = join(process.cwd(), 'backend', 'data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    writeFileSync(ONBOARDED_FLAG, Date.now().toString(), 'utf-8');
    if (existsSync(ONBOARD_RETRY_FLAG)) {
      try {
        rmSync(ONBOARD_RETRY_FLAG, { force: true });
      } catch {}
    }
    return;
  }

  logger.info('检测到首次运行，启动初始化引导...');

  try {
    const { runOnboard } =
      await import('./commands/builtin/onboard/Onboard.js');

    const result = await runOnboard();

    if (result.length > 0) {
      logger.info(result.join('\n'));
    }

    const dataDir = join(process.cwd(), 'backend', 'data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    writeFileSync(ONBOARDED_FLAG, Date.now().toString(), 'utf-8');

    // 清除重试计数
    if (existsSync(ONBOARD_RETRY_FLAG)) {
      try {
        rmSync(ONBOARD_RETRY_FLAG, { force: true });
      } catch {}
    }

    if (await isAIConfigured()) {
      isOfflineMode = false;
      console.log('  ✅ AI 已配置，准备就绪！');
    } else {
      console.log('  💡 提示: AI 密钥未配置，将进入离线模式。');
      console.log('  您可以稍后通过 /onboard 或 /config 命令配置。');
    }

    logger.info('初始化引导完成');
  } catch (error) {
    // 增加重试计数
    retryCount++;
    try {
      const dataDir = join(process.cwd(), 'backend', 'data');
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
      }
      writeFileSync(ONBOARD_RETRY_FLAG, String(retryCount), 'utf-8');
    } catch {}

    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warning('初始化引导失败，可使用 /onboard 命令手动启动', {
      error: errorMsg,
    });

    // 向控制台输出友好错误（用户能看到）
    console.log('  ⚠️ 自动引导遇到问题，跳过配置。');
    console.log('  您可以随时输入 /onboard 手动启动配置向导。');
    console.log('');
    console.log('  📖 快速开始:');
    console.log('  1. 获取 API 密钥: https://platform.deepseek.com/api_keys');
    console.log('  2. 输入 /onboard 启动配置向导');
    console.log('  3. 或输入 /help 查看可用命令');
    console.log('');

    // 创建标记文件防止每次启动都失败
    if (retryCount >= MAX_ONBOARD_RETRIES) {
      const dataDir = join(process.cwd(), 'backend', 'data');
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
      }
      writeFileSync(ONBOARDED_FLAG, Date.now().toString(), 'utf-8');
    }
  }
}

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
    // Windows 终端 UTF-8 编码适配
    // 必须在任何中文输出之前执行，使用 inherit 共享控制台上下文
    try {
      execSync('@chcp 65001 > nul', {
        timeout: 3000,
        stdio: 'inherit',
        shell: 'cmd.exe',
      });
    } catch {
      // 非致命，部分终端可能不支持
    }
    try {
      process.stdout.write('\x1b]0;PY_APP\x07');
    } catch {
      // 非致命
    }
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

  await checkFirstRunAndOnboard();

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
 *
 * 启动阶段分为：
 *   T0: 并行预读取（不阻塞模块初始化）
 *   T1: 模块系统初始化（仅 CRITICAL 模块，DEFERRED 模块延迟加载）
 *   T2: 模式分发 + 后台延迟加载
 */
export async function launch(options: LaunchOptions): Promise<void> {
  setupWindowsSecurity();

  profileCheckpoint('launch_start');
  profilePhaseStart('launch_total');

  try {
    logger.info(`应用启动 - 模式: ${options.mode}`);

    // T0: 启动并行预读取（不阻塞模块初始化）
    profileCheckpoint('T0_preroll_start');
    profilePhaseStart('T0_preroll');
    startMdmPrefetch();
    if (process.platform === 'darwin') {
      startKeychainPrefetch(
        ['PY_APP', 'com.pyapp.api-key'],
        process.env.USER || ''
      );
    }
    profilePhaseEnd('T0_preroll');
    profileCheckpoint('T0_preroll_end');

    // T1: 模块系统初始化（仅 CRITICAL 模块）
    profileCheckpoint('module_init_start');
    profilePhaseStart('T1_module_init');

    // 显示加载提示（在 T1 执行期间给用户进度反馈）
    process.stdout.write('⏳ PY_APP 正在加载模块...\r');

    await initializeModuleSystem();

    // 清除加载提示行
    process.stdout.write('\x1b[K');
    profilePhaseEnd('T1_module_init');
    profileCheckpoint('module_init_end');

    // T1.5: 等待关键预读取完成
    profileCheckpoint('T1_await_prefetch_start');
    profilePhaseStart('T1_await_prefetch');
    await ensureMdmPrefetchCompleted();
    if (process.platform === 'darwin') {
      await ensureKeychainPrefetchCompleted();
    }
    profilePhaseEnd('T1_await_prefetch');
    profileCheckpoint('T1_await_prefetch_end');

    // T2: 模式分发 + 后台延迟加载
    profileCheckpoint('T2_dispatch_start');
    profilePhaseStart('T2_dispatch');
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
    profilePhaseEnd('T2_dispatch');
    profileCheckpoint('T2_dispatch_end');

    // T3: 启动完成后，在后台调度延迟模块加载
    profilePhaseStart('T3_deferred_load');
    try {
      const { moduleInitializer } = await import('./modules/ModuleInitializer');
      moduleInitializer.scheduleDeferredModules();
    } catch (e) {
      logger.warning('调度延迟模块加载失败（非致命）', e as Error);
    }
    profilePhaseEnd('T3_deferred_load');

    profilePhaseEnd('launch_total');

    const { totalDuration, phaseSummary } = getPhaseSummary();
    const significantPhases = phaseSummary.filter((s) => s.duration >= 1.0);
    logger.info(`启动完成 (${totalDuration.toFixed(0)}ms)`);
    for (const summary of significantPhases) {
      logger.info(
        `  ${summary.phase}: ${summary.duration.toFixed(1)}ms (${(summary.ratio * 100).toFixed(1)}%)`
      );
    }

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
