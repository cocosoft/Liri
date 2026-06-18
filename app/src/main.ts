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
import {
  getLogger,
  flush,
  setGlobalConfigProvider,
  setGlobalBufferConfig,
} from './monitoring/logs/Logger';
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
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import {
  resolveProjectRoot,
  resolveDataDir,
  resolveOnboardedFlagPath,
  resolveOutputDir,
  resolveDownloadsDir,
  resolvePyappHome,
  ensureDataDirectories,
  validatePathConsistency,
} from '@modules/core/paths';
import { modelRouter } from '@modules/ai/modelRouter';
import { configManager } from './config/index.js';
import { isOfflineMode, setOfflineMode } from './entrypoints/shared-state.js';

const logger = getLogger('main');

/** 最大首次引导重试次数 */
const MAX_ONBOARD_RETRIES = 3;

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
    if (isValidApiKey(configManager.env('DEEPSEEK_API_KEY'))) return true;
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
      setOfflineMode(false);
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
  if (configManager.env('LIRI_HTTP_STARTED') === '1') {
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
      } catch {} // @ignore-catch: 清理重试标志文件，失败不影响流程
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
      } catch {} // @ignore-catch: 清理重试标志文件，失败不影响流程
    }

    if (await isAIConfigured()) {
      setOfflineMode(false);
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
    } catch {} // @ignore-catch: 重试计数写入失败不影响主流程

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

/** 锁文件路径 */
function getLockFilePath(): string {
  return join(resolveDataDir(), '.liri.lock');
}

/**
 * 单实例锁检查（PID 文件锁）
 *
 * 在进程启动时检查是否存在锁文件，若存在且对应进程存活则退出，
 * 防止多实例导致 QQ/Telegram 等通道双回复或数据竞争。
 * 进程正常退出时自动清理锁文件。
 */
function checkSingletonInstance(): void {
  const lockFile = getLockFilePath();

  // 确保数据目录存在
  const dataDir = resolveDataDir();
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // 检查锁文件
  if (existsSync(lockFile)) {
    try {
      const pid = parseInt(readFileSync(lockFile, 'utf-8').trim(), 10);
      if (!isNaN(pid)) {
        // 检查对应进程是否存活（不发送信号，仅探测）
        try {
          process.kill(pid, 0);
          logger.warning(`检测到已有实例在运行 (PID: ${pid})，当前实例将退出`);
          process.exit(1);
        } catch {
          // 进程不存在，锁文件过期，继续启动
          logger.info(`检测到过期锁文件 (PID: ${pid}，进程已不存在)，将覆盖`);
        }
      }
    } catch {
      // 锁文件内容异常，忽略并覆盖
      logger.warning('锁文件内容异常，将覆盖');
    }
  }

  // 写入当前 PID
  writeFileSync(lockFile, String(process.pid), 'utf-8');

  // 注册进程退出清理
  const cleanup = () => {
    try {
      if (existsSync(lockFile)) {
        const currentPid = parseInt(readFileSync(lockFile, 'utf-8').trim(), 10);
        if (currentPid === process.pid) {
          unlinkSync(lockFile);
        }
      }
    } catch {
      // 清理失败不阻塞退出
    }
  };

  process.on('exit', () => {
    cleanup();
    // 同步 exit 事件不支持 async，fire-and-forget flush
    flush().catch(() => {});
  });
  process.on('SIGINT', () => {
    cleanup();
    flush().finally(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    cleanup();
    flush().finally(() => process.exit(0));
  });
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
 * 启动 CLI 模式（通过 DI 回调，避免循环依赖）
 * @deprecated 启动路径已统一到 ModuleRegistry.bootstrap()。
 * init() 由 bootstrap() 内部调用，此函数仅保留模式分发逻辑。
 */
let _cliMain: (() => Promise<void>) | null = null;
export function setCliMain(fn: () => Promise<void>): void {
  _cliMain = fn;
}

async function launchCLI(_options: LaunchOptions): Promise<void> {
  if (!_cliMain) {
    throw new Error(
      'CLI main function not registered. Import cli.tsx directly instead.'
    );
  }
  await _cliMain();
}

/**
 * 启动 REPL 模式
 * @deprecated 启动路径已统一到 ModuleRegistry.bootstrap()。
 * init() 由 bootstrap() 内部调用，此函数仅保留模式分发逻辑。
 */
async function launchREPL(options: LaunchOptions): Promise<void> {
  // 解析 --model 参数并设为全局模型
  const modelArg = parseModelFromArgs(options.args);
  if (modelArg) {
    modelRouter.setCurrentModel(modelArg);
  }

  const httpPort = parseHttpPortFromArgs(options.args) || 7890;
  const useLegacyRepl = options.args?.includes('--legacy-repl') || false;

  // 解析 --trust-level 参数（场景选择联动）
  const trustLevelArg = parseTrustLevelFromArgs(options.args);

  // 启动 HTTP 服务先于首次运行引导，使前端在终端阻塞时也能连接
  const { startHTTPServer } = await import('./entrypoints/repl');
  let httpService: Awaited<ReturnType<typeof startHTTPServer>> | null = null;
  try {
    httpService = await startHTTPServer(httpPort);
    process.env.LIRI_HTTP_STARTED = '1';
    logger.info(`HTTP 服务已启动: http://127.0.0.1:${httpPort}`);
  } catch (e) {
    logger.warning('HTTP 服务启动失败，引导期间前端不可用', {
      error: String(e),
    });
  }

  await checkFirstRunAndOnboard();

  // 启动后异步展示健康报告（延迟执行，不阻塞 REPL 启动）
  displayStartupHealthReport();

  // REPL 启动前，初始化通道持久化并后台连接
  try {
    const { setupChannelsFromConfig, lazyConnectChannels } =
      await import('./channels/setupChannels');
    const { channelRegistry } =
      await import('./channels/registry/ChannelRegistry');

    await channelRegistry.initPersistence();
    logger.info('main.ts 通道持久化初始化完成');

    // 启用主动同步：ChannelPluginRegistry 状态变更 → 实时反映到 ChannelRegistry
    channelRegistry.setupActiveSync();

    // 从 DB 恢复已保存的通道配置（注册到内存）
    await setupChannelsFromConfig();
    logger.info('通道配置已从 DB 恢复');

    // 后台连接已启用的通道（不阻塞 REPL 启动）
    lazyConnectChannels().catch((err) => {
      logger.error('延迟通道连接异常', { error: String(err) });
    });
  } catch (err) {
    logger.error('通道初始化失败', { error: String(err) });
  }

  const { launchRepl } = await import('./entrypoints/repl');
  await launchRepl({
    httpPort,
    useLegacyRepl,
    preStartedHttp: httpService ?? undefined,
    trustLevel: trustLevelArg,
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
 * 从命令行参数中解析 --model 值
 */
function parseModelFromArgs(args?: string[]): string | undefined {
  if (!args) return undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && i + 1 < args.length) {
      return args[i + 1];
    }
    if (args[i].startsWith('--model=')) {
      return args[i].split('=')[1];
    }
  }

  return undefined;
}

/**
 * 从命令行参数中解析 --trust-level 值
 * 用于场景选择联动：聊天(chat)/工作(work)/开发(development)
 */
function parseTrustLevelFromArgs(args?: string[]): string | undefined {
  if (!args) return undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--trust-level' && i + 1 < args.length) {
      const level = args[i + 1].toLowerCase();
      if (['chat', 'work', 'development'].includes(level)) {
        return level;
      }
    }
    if (args[i].startsWith('--trust-level=')) {
      const level = args[i].split('=')[1].toLowerCase();
      if (['chat', 'work', 'development'].includes(level)) {
        return level;
      }
    }
  }

  return undefined;
}

/**
 * 启动 MCP 服务器模式
 * @deprecated 启动路径已统一到 ModuleRegistry.bootstrap()。
 * init() 由 bootstrap() 内部调用，此函数仅保留模式分发逻辑。
 */
async function launchMCPServer(options: LaunchOptions): Promise<void> {
  const { startMCPServer } = await import('./entrypoints/mcp');
  await startMCPServer(
    resolveProjectRoot(),
    options.debug ?? false,
    options.verbose ?? false
  );
}

/**
 * 启动后台守护进程模式
 * @deprecated 启动路径已统一到 ModuleRegistry.bootstrap()。
 * init() 由 bootstrap() 内部调用，此函数仅保留模式分发逻辑。
 */
async function launchDaemon(options: LaunchOptions): Promise<void> {
  logger.info('后台守护进程模式启动（当前复用 REPL 模式）');
  const { launchRepl } = await import('./entrypoints/repl');
  await launchRepl({ useLegacyRepl: true });
}

/**
 * 启动测试模式
 * @deprecated 启动路径已统一到 ModuleRegistry.bootstrap()。
 * init() 由 bootstrap() 内部调用，此函数仅保留模式分发逻辑。
 */
async function launchTest(_options: LaunchOptions): Promise<void> {
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
  // 统一数据根目录：确保 LIRI_HOME 已设置，所有下游模块使用一致路径
  if (!process.env.LIRI_HOME) {
    process.env.LIRI_HOME = resolvePyappHome();
  }
  validatePathConsistency({ warn: (msg) => logger.warning(msg) });
  setupWindowsSecurity();

  // 单实例锁检查（PID 文件锁），防止多实例启动导致通道双回复
  checkSingletonInstance();

  // 全局未捕获异常兜底（handleError 标准化处理）
  // 在模块系统初始化之前注册，确保早期启动阶段的错误也能被捕获
  {
    // 标记是否已执行退出逻辑
    let fatalExiting = false;

    process.on('uncaughtException', (error: Error) => {
      // 避免递归死循环
      if (fatalExiting) {
        process.exit(1);
      }
      fatalExiting = true;

      logger.error('uncaughtException', error);

      // 动态 import handleError（模块系统可能尚未初始化，使用动态导入降低依赖风险）
      import('./error/handleError.js')
        .then(({ handleError }) =>
          handleError(error, {
            module: 'app:top',
            action: 'uncaughtException',
          })
        )
        .catch(() => {
          // handleError 导入失败时，至少记录到 stderr
          logger.error('handleError 不可用', { error: String(error) });
        })
        .finally(() => {
          process.exit(1); // 不可恢复，退出
        });
    });

    process.on('unhandledRejection', (reason: unknown) => {
      logger.error('unhandledRejection', { reason: String(reason) });

      import('./error/handleError.js')
        .then(({ handleError }) =>
          handleError(reason, {
            module: 'app:top',
            action: 'unhandledRejection',
          })
        )
        .catch(() => {
          logger.error('handleError 不可用（unhandledRejection）', {
            reason: String(reason),
          });
        });
      // 不退出进程，unhandledRejection 可能是非致命的
    });
  }

  // 注册全局日志配置提供者：后续所有 Logger 实例自动启用文件写入
  setGlobalConfigProvider(() => {
    const logCfg = LogConfigManager.getInstance().get();
    const fileTarget = logCfg.targets.find((t) => t.type === 'file');
    return {
      fileOutput: true,
      logFile: fileTarget?.path,
      level: logCfg.level,
      format: logCfg.format as 'text' | 'json',
      colorize: logCfg.colorize,
      otelTraceEnabled: logCfg.otelTraceEnabled,
    };
  });

  // 注册全局缓冲区配置，与 LogConfig 中的 maxBufferSize/flushInterval 对齐
  setGlobalBufferConfig(
    LogConfigManager.getInstance().get().maxBufferSize,
    LogConfigManager.getInstance().get().flushInterval
  );

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
        configManager.env('USER') || ''
      );
    }
    profilePhaseEnd('T0_preroll');
    profileCheckpoint('T0_preroll_end');

    // T1: 模块系统初始化 — 使用 ModuleRegistry.bootstrap() 统一入口
    // 替代旧的 initializeModuleSystem() → quickInitialize() 路径
    profileCheckpoint('module_init_start');
    profilePhaseStart('T1_module_init');

    // 显示加载提示（在 T1 执行期间给用户进度反馈）
    process.stdout.write('⏳ Liri 正在加载模块...\r');

    const { moduleRegistry } = await import('./modules/ModuleRegistry');
    await moduleRegistry.bootstrap({
      mode: options.mode as any,
      args: options.args,
      debug: options.debug,
      verbose: options.verbose,
    });

    // 清除加载提示行
    process.stdout.write('\x1b[K');
    profilePhaseEnd('T1_module_init');
    profileCheckpoint('module_init_end');

    // T1.2: 读取 LIRI_TRUSTED_WORKSPACE 环境变量，映射到 permission.trustedWorkspaces
    // 仅在 config.json 中无 trustedWorkspaces 配置时注入
    try {
      const trustedWorkspace = configManager.env('LIRI_TRUSTED_WORKSPACE');
      if (trustedWorkspace) {
        const existing = configManager.getConfigValue<any>('permission');
        if (!existing?.trustedWorkspaces?.length) {
          let wsPath = trustedWorkspace;
          let wsLevel: string = 'development';
          // 支持语法扩展：LIRI_TRUSTED_WORKSPACE=path|level
          const pipeIdx = trustedWorkspace.lastIndexOf('|');
          if (pipeIdx > 0) {
            wsPath = trustedWorkspace.slice(0, pipeIdx);
            wsLevel = trustedWorkspace.slice(pipeIdx + 1);
          }
          configManager.setConfigValue('permission', {
            mode: 'default',
            trustedWorkspaces: [
              {
                path: wsPath,
                trustLevel: wsLevel,
                enabled: true,
              },
            ],
          });
        }
      }
    } catch {
      // 非致命：env 读取失败时静默跳过
    }

    // T1.25: 加载模型配置（从 YAML + DB 单一数据源）
    try {
      const { ModelRegistry } =
        await import('@modules/ai/models/ModelRegistry');
      const registry = ModelRegistry.getInstance();
      registry.loadDefaultModels();
      registry.loadUserConfigs();

      // 初始化模型注册表 DB（创建 model_registry 表、从 YAML 种子、迁移旧表）
      const { modelPricingService } =
        await import('@modules/ai/models/ModelPricingService.js').catch(() => {
          return { modelPricingService: null as any };
        });
      if (modelPricingService) {
        await modelPricingService.initialize();
      } else {
        // 将 DB 定价加载到 ModelRegistry 内存缓存（定价单一事实来源）
        await registry.loadDbPricing();
      }
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

    // T1.8: 初始化 SmartRouter 智能路由（非阻塞，失败不影响主流程）
    try {
      const { SmartRouter } = await import('@modules/ai/router/SmartRouter');
      const { providerRegistry } =
        await import('@modules/ai/providers/ProviderRegistry');
      const { configManager } = await import('@modules/config/ConfigManager');

      // 从 configManager 读取路由配置，若无则使用默认值
      const routerCfg =
        configManager.getConfigValue<Record<string, unknown>>(
          'models.router'
        ) || {};
      const routerConfig: import('@modules/ai/router/types').RouterConfig = {
        enabled: (routerCfg as any)?.enabled !== false,
        defaultTier: ((routerCfg as any)?.defaultTier as any) || 'medium',
        sessionSticky: (routerCfg as any)?.sessionSticky !== false,
        tiers: {
          simple: { model: 'deepseek-v4-flash', providerHint: 'deepseek' },
          medium: { model: 'deepseek-v4-flash', providerHint: 'deepseek' },
          complex: { model: 'deepseek-v4-pro', providerHint: 'deepseek' },
          reasoning: { model: 'deepseek-reasoner', providerHint: 'deepseek' },
        },
      };

      const smartRouter = new SmartRouter({
        config: routerConfig,
        providerRegistry,
      });

      // 注入 CoreAPIImpl 全局单例
      const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');
      getCoreAPI().setSmartRouter(smartRouter);
      logger.info('SmartRouter 已初始化并注入 CoreAPIImpl');
    } catch (e) {
      logger.warning(
        'SmartRouter 初始化失败（非致命，使用静态路由）',
        e as Error
      );
    }

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

    // T3: 延迟模块加载已由 ModuleRegistry.bootstrap() 内部调度
    // 不再需要在此重复调用 scheduleDeferredModules()
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
    await (
      await import('./error/handleError.js')
    ).handleError(error, { module: 'app:main', action: 'launch' });
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
