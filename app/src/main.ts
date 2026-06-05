#!/usr/bin/env bun
// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import {
  profileCheckpoint,
  profileReport,
  profilePhaseStart,
  profilePhaseEnd,
  getPhaseSummary,
} from './utils/startupProfiler';
import { Logger, setGlobalConfigProvider } from './monitoring/logs/Logger';
import { LogConfigManager } from './monitoring/logs/config/LogConfig';
import {
  startMdmPrefetch,
  ensureMdmPrefetchCompleted,
} from './infrastructure/startup/MdmPrefetch';
import {
  startKeychainPrefetch,
  ensureKeychainPrefetchCompleted,
} from './infrastructure/startup/KeychainPrefetch';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import {
  resolveProjectRoot,
  resolveDataDir,
  resolveOnboardedFlagPath,
  resolveOutputDir,
  resolveDownloadsDir,
  ensureDataDirectories,
} from '@modules/core/paths';

const logger = new Logger({ level: 'info' as any });

/** 最大首次引导重试次数 */
const MAX_ONBOARD_RETRIES = 3;

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
 * 获取首次运行标记文件路径
 * 委托给 paths.ts 的集中管理函数
 */
function getOnboardedFlagPath(): string {
  return resolveOnboardedFlagPath();
}

/**
 * 获取 .env 文件路径
 */
function getEnvFilePath(): string {
  return join(resolveProjectRoot(), '.env');
}

/**
 * 获取 .env.example 文件路径
 */
function getEnvExamplePath(): string {
  return join(resolveProjectRoot(), '.env.example');
}

/**
 * 获取引导重试计数文件路径
 */
function getOnboardRetryFlagPath(): string {
  return join(resolveDataDir(), '.onboard_retry');
}

/**
 * 获取数据目录路径
 */
function getDataDir(): string {
  return resolveDataDir();
}

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
      ((ai?.['deepseek'] as Record<string, unknown> | undefined)?.[
        'apiKey'
      ] as string) ||
      '';
    return isValidApiKey(apiKey);
  } catch {
    return false;
  }
}

/**
 * 检查是否为首次运行（无配置的初始化）
 *
 * 通过检查 app/data/.onboarded 标记文件来判断。
 * 若文件不存在，自动触发引导流程。
 */
async function checkFirstRunAndOnboard(): Promise<void> {
  const onboardedFlag = getOnboardedFlagPath();
  const envFile = getEnvFilePath();
  const envExample = getEnvExamplePath();
  const onboardRetryFlag = getOnboardRetryFlagPath();
  const dataDir = getDataDir();

  if (existsSync(onboardedFlag)) {
    // 已有标记文件，检查 AI 状态
    if (await isAIConfigured()) {
      isOfflineMode = false;
    }
    return;
  }

  // 首次运行：确保 .env 文件存在（从 .env.example 模板创建）
  if (!existsSync(envFile) && existsSync(envExample)) {
    try {
      const exampleContent = readFileSync(envExample, 'utf-8');
      // 替换占位密钥为空，引导用户填写真实密钥
      const envContent = exampleContent.replace(
        /DEEPSEEK_API_KEY=.*/,
        '# 请将下方密钥替换为你的真实 DeepSeek API 密钥\n# 获取地址: https://platform.deepseek.com/api_keys\nDEEPSEEK_API_KEY='
      );
      writeFileSync(envFile, envContent, 'utf-8');
      logger.info('.env 文件已自动创建（来自 .env.example）');
    } catch (e) {
      logger.warn('自动创建 .env 文件失败', { error: String(e) });
    }
  }

  // 检查重试次数
  let retryCount = 0;
  if (existsSync(onboardRetryFlag)) {
    try {
      retryCount = parseInt(readFileSync(onboardRetryFlag, 'utf-8').trim(), 10);
    } catch {
      retryCount = 0;
    }
  }

  console.log('');
  console.log('🎉 欢迎使用 Liri，准备配置向导...');
  console.log('');

  // 若 HTTP 服务已在运行，提示用户可通过浏览器完成初始化
  if (process.env.LIRI_HTTP_STARTED === '1') {
    console.log('  💻 也可打开浏览器访问前端页面完成初始化配置。');
    console.log('');
  }

  if (retryCount >= MAX_ONBOARD_RETRIES) {
    console.log('  ⚠️ 引导已重试多次，跳过自动引导。');
    console.log('  您可以随时输入 /onboard 手动启动配置。');
    console.log('');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    writeFileSync(onboardedFlag, Date.now().toString(), 'utf-8');
    if (existsSync(onboardRetryFlag)) {
      try {
        rmSync(onboardRetryFlag, { force: true });
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

    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    writeFileSync(onboardedFlag, Date.now().toString(), 'utf-8');

    // 清除重试计数
    if (existsSync(onboardRetryFlag)) {
      try {
        rmSync(onboardRetryFlag, { force: true });
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
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
      }
      writeFileSync(onboardRetryFlag, String(retryCount), 'utf-8');
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
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
      }
      writeFileSync(onboardedFlag, Date.now().toString(), 'utf-8');
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
      process.stdout.write('\x1b]0;Liri\x07');
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
 * 启动后异步展示精简版健康报告
 * 不阻塞 REPL 启动，仅作为信息提示
 */
async function displayStartupHealthReport(): Promise<void> {
  try {
    const { systemHealthChecker, formatHealthReport } =
      await import('./diagnostics/SystemHealthChecker');
    const report = await systemHealthChecker.performFullCheck();
    console.log(formatHealthReport(report));
  } catch {
    // 健康报告展示失败不影响主流程
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

  const httpPort = parseHttpPortFromArgs(options.args);
  const useLegacyRepl = options.args?.includes('--legacy-repl') || false;

  // 启动 HTTP 服务先于首次运行引导，使前端在终端阻塞时也能连接
  const { startHTTPServer } = await import('./entrypoints/repl');
  let httpService: Awaited<ReturnType<typeof startHTTPServer>> | null = null;
  try {
    httpService = await startHTTPServer(httpPort);
    process.env.LIRI_HTTP_STARTED = '1';
    logger.info(`HTTP 服务已启动: http://127.0.0.1:${httpPort}`);
  } catch (e) {
    logger.warning('HTTP 服务启动失败，引导期间前端不可用', { error: String(e) });
  }

  await checkFirstRunAndOnboard();

  // 启动后异步展示健康报告（延迟执行，不阻塞 REPL 启动）
  displayStartupHealthReport();

  const { launchRepl } = await import('./entrypoints/repl');
  await launchRepl({
    httpPort,
    useLegacyRepl,
    preStartedHttp: httpService ?? undefined,
  });

  // REPL 完全启动后，初始化通道持久化并后台连接，不阻塞用户交互
  import('./channels/setupChannels').then(({ lazyConnectChannels }) => {
    import('./channels/registry/ChannelRegistry').then(({ channelRegistry }) => {
      channelRegistry.initPersistence().then(() => {
        lazyConnectChannels().catch((err) => {
          logger.error('延迟通道连接异常', { error: String(err) });
        });
      }).catch((err) => {
        logger.error('通道持久化初始化失败', { error: String(err) });
      });
    });
  });
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
    resolveProjectRoot(),
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
  await launchRepl({ useLegacyRepl: true });
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

  // 注册全局日志配置提供者：后续所有 Logger 实例自动启用文件写入
  setGlobalConfigProvider(() => {
    const logCfg = LogConfigManager.getInstance().get();
    const fileTarget = logCfg.targets.find((t) => t.type === 'file');
    return {
      fileOutput: true,
      logFile: fileTarget?.path,
      level: logCfg.level,
      format: logCfg.format as 'text' | 'json',
    };
  });

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
        ['Liri', 'com.liri.api-key'],
        process.env.USER || ''
      );
    }
    profilePhaseEnd('T0_preroll');
    profileCheckpoint('T0_preroll_end');

    // T1: 模块系统初始化（仅 CRITICAL 模块）
    profileCheckpoint('module_init_start');
    profilePhaseStart('T1_module_init');

    // 显示加载提示（在 T1 执行期间给用户进度反馈）
    process.stdout.write('⏳ Liri 正在加载模块...\r');

    await initializeModuleSystem();

    // 清除加载提示行
    process.stdout.write('\x1b[K');
    profilePhaseEnd('T1_module_init');
    profileCheckpoint('module_init_end');

    // T1.25: 加载模型配置（从 YAML + 用户覆盖）
    try {
      const { ModelRegistry } =
        await import('@modules/ai/models/ModelRegistry');
      const registry = ModelRegistry.getInstance();
      registry.loadDefaultModels();
      registry.loadUserConfigs();
    } catch (e) {
      logger.warning('加载模型配置失败（非致命）', e as Error);
    }

    // T1.5: 等待关键预读取完成
    profileCheckpoint('T1_await_prefetch_start');
    profilePhaseStart('T1_await_prefetch');
    await ensureMdmPrefetchCompleted();
    if (process.platform === 'darwin') {
      await ensureKeychainPrefetchCompleted();
    }
    profilePhaseEnd('T1_await_prefetch');
    profileCheckpoint('T1_await_prefetch_end');

    // T1.75: 初始化 ACP 模块桥接（非阻塞，失败不影响主流程）
    import('./bridge/ModuleBridgeSetup.js').then(
      ({ setupModuleBridgeOnStartup }) => {
        setupModuleBridgeOnStartup().catch((err) => {
          logger.warning('ACP 模块桥接初始化异常（非致命）', {
            error: String(err),
          });
        });
      }
    );

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
  // 先解析 --project-dir 参数，确保路径解析在所有模块加载前生效
  const argv = [...process.argv];
  let projectDir: string | undefined;
  const filteredArgv: string[] = [];
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--project-dir' && i + 1 < argv.length) {
      projectDir = argv[i + 1];
      i++; // 跳过值
    } else if (argv[i].startsWith('--project-dir=')) {
      projectDir = argv[i].split('=')[1];
    } else {
      filteredArgv.push(argv[i]);
    }
  }
  if (projectDir) {
    process.env.LIRI_PROJECT_DIR = projectDir;
  }

  // 统一工作目录到项目根路径
  // 避免 tools（Bash/Glob/Grep 等）使用 process.cwd() 时指向 app/ 子目录
  process.chdir(resolveProjectRoot());

  // 设置 AI 生成文件的专用输出目录
  // AI 通过 Bash/write_to_file 等工具生成的文件应写到此目录
  process.env.OUTPUT_DIR = resolveOutputDir();

  // 设置 AI 下载材料的存放目录
  // AI 的 WebFetch/WebSearch 等工具下载的文件应存到此目录
  process.env.DOWNLOADS_DIR = resolveDownloadsDir();

  // 确保所有依赖路径的目录结构存在
  ensureDataDirectories();

  let mode: LaunchMode;
  let args: string[];

  if (filteredArgv.length > 0 && !filteredArgv[0].startsWith('--')) {
    mode = (filteredArgv[0] as LaunchMode) || LaunchMode.REPL;
    args = filteredArgv.slice(1);
  } else {
    mode = LaunchMode.REPL;
    args = [...filteredArgv];
  }

  // 默认使用legacy REPL，避免ink TUI的问题
  if (!args.includes('--legacy-repl') && !args.includes('--no-legacy-repl')) {
    args.push('--legacy-repl');
  }

  await launch({ mode, args });
}

if (import.meta.main) {
  main();
}
