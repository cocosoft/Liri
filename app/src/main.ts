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
} from './performance/StartupProfiler.js';
import {
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
} from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import {
  resolveProjectRoot,
  resolveDataDir,
  resolveOnboardedFlagPath,
  resolveOutputDir,
  resolveDownloadsDir,
  resolvePyappHome,
  ensureDataDirectories,
  validatePathConsistency,
  syncSeedData,
} from '@modules/core';
import { modelRouter } from '@modules/ai';
import {
  configManager,
  injectTrustedWorkspaceFromEnv,
} from './config/index.js';
import { isOfflineMode, setOfflineMode } from './entrypoints/shared-state.js';
import {
  hydrateOnStartup,
  serializeOnShutdownSync,
} from './context/persistence/ContextPersistenceLifecycle.js';
import { contextManager } from './context/ContextManager.js';

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
const logger = new Logger({ module: 'main', level: LogLevel.INFO });

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
 * 与 pyapp.ts 启动加载路径保持一致：app/.env
 */
function getEnvFilePath(): string {
  return join(resolveProjectRoot(), 'app', '.env');
}

/**
 * 获取 .env.example 文件路径
 * 位于 app/.env.example
 */
function getEnvExamplePath(): string {
  return join(resolveProjectRoot(), 'app', '.env.example');
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
    // 数出同源：DB 是 API Key 的唯一事实来源，无数据时前端引导用户配置
    const { providerManager } =
      await import('./ai/providers/ProviderManager.js');
    const dbProviders = await providerManager.listProviders({ isActive: true });
    return dbProviders.some((p) => isValidApiKey(p.apiKey));
  } catch {
    return false;
  }
}

/**
 * 确保 .env 文件存在
 *
 * 在 HTTP 服务启动前调用，避免服务因缺少环境变量而失败。
 * 从 .env.example 模板自动创建，如果模板也不存在则静默跳过。
 */
function ensureEnvFileExists(): void {
  const envFile = getEnvFilePath();
  const envExample = getEnvExamplePath();

  if (existsSync(envFile)) {
    return; // 已存在，无需创建
  }

  if (!existsSync(envExample)) {
    logger.warn('.env.example 模板文件不存在，无法自动创建 .env', {
      expectedPath: envExample,
    });
    return;
  }

  try {
    const exampleContent = readFileSync(envExample, 'utf-8');
    // 替换占位密钥为空，引导用户填写真实密钥
    const envContent = exampleContent.replace(
      /DEEPSEEK_API_KEY=.*/,
      '# 请将下方密钥替换为你的真实 DeepSeek API 密钥\n# 获取地址: https://platform.deepseek.com/api_keys\nDEEPSEEK_API_KEY='
    );
    writeFileSync(envFile, envContent, 'utf-8');
    logger.info('.env 文件已自动创建（来自 .env.example）', {
      envFile,
    });

    // 重新加载环境变量，使新创建的 .env 文件生效
    // 注意：这是增量加载，不覆盖已存在的环境变量（与 pyapp.ts 行为一致）
    try {
      const reloadedCount = reloadEnvFromFile(envFile);
      logger.info(`已从 .env 重新加载 ${reloadedCount} 个环境变量`);
    } catch (reloadErr) {
      logger.warn('重新加载 .env 失败（非致命）', {
        error: String(reloadErr),
      });
    }
  } catch (e) {
    logger.warn('自动创建 .env 文件失败', { error: String(e) });
  }
}

/**
 * 从指定 .env 文件重新加载环境变量
 * 仅设置尚未存在的变量（与 pyapp.ts 行为一致，不覆盖已有值）
 * @returns 成功加载的变量数量
 */
function reloadEnvFromFile(envPath: string): number {
  const content = readFileSync(envPath, 'utf-8');
  let count = 0;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
      count++;
    }
  }
  return count;
}

/**
 * 启动时关键依赖完整性校验
 *
 * 扫描关键依赖（sharp, pdfjs-dist, sqlite3），缺失时给出明确指引。
 * 非阻塞：校验失败不阻止启动，但会输出清晰的修复指引到 stderr。
 *
 * @returns 校验结果，包含是否全部通过和问题列表
 */
async function checkCriticalDependencies(): Promise<{
  ok: boolean;
  issues: string[];
}> {
  const issues: string[] = [];

  // 1. 检查 .env 配置文件
  const envFile = getEnvFilePath();
  if (!existsSync(envFile)) {
    issues.push(
      `缺少 .env 配置文件: ${envFile}\n` +
        '  修复: 复制 app/.env.example 为 app/.env，并填写必填的 API 密钥。'
    );
  }

  // 2. 检查 bun:sqlite（数据库核心依赖）
  try {
    require.resolve('bun:sqlite');
  } catch (err) {
    issues.push(
      '缺少 bun:sqlite 模块（数据库核心依赖）。请确保使用 Bun 运行时启动应用。'
    );
  }

  // 3. 检查 sharp（图片处理，原生 C++ 模块，ABI 敏感）
  try {
    require.resolve('sharp');
  } catch (err) {
    issues.push(
      '缺少 sharp 模块（图片处理依赖）。请确保 node_modules/sharp 已正确安装。\n' +
        '  修复: 在应用目录执行 bun install，确保 sharp 的原生二进制与当前系统兼容。'
    );
  }

  // 4. 检查 pdfjs-dist（PDF 解析依赖）
  try {
    require.resolve('pdfjs-dist/legacy/build/pdf');
  } catch (err) {
    // 尝试不带 legacy 路径的解析
    try {
      require.resolve('pdfjs-dist');
    } catch (err) {
      issues.push(
        '缺少 pdfjs-dist 模块（PDF 解析依赖）。请确保 node_modules/pdfjs-dist 已正确安装。\n' +
          '  修复: 在应用目录执行 bun install。'
      );
    }
  }

  if (issues.length > 0) {
    const header = '\n' + '='.repeat(60) + '\n';
    const footer = '='.repeat(60) + '\n';
    console.error(
      header +
        '  [启动检查] 发现以下关键依赖问题:\n' +
        issues.map((i, idx) => `  ${idx + 1}. ${i}`).join('\n') +
        '\n' +
        footer
    );
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Phase 2.2: 将 SOUL.md / USER.md 从文件系统迁移到 ConfigManager
 *
 * 仅在 ConfigManager 中无数据且文件系统有旧文件时执行迁移。
 * 迁移后将内容写入 ConfigManager，旧文件保留不删除（向后兼容）。
 */
async function migrateSoulAndUserToConfigManager(
  configMgr: typeof configManager
): Promise<void> {
  try {
    const { resolveSoulPath, resolveUserProfilePath } =
      await import('@modules/core');

    // 迁移 SOUL.md
    const soulConfig = configMgr.getConfigValue('settings.soul') as
      | { content?: string }
      | undefined;
    if (!soulConfig?.content) {
      const soulPath = resolveSoulPath();
      if (existsSync(soulPath)) {
        try {
          const content = readFileSync(soulPath, 'utf-8');
          if (content.trim()) {
            configMgr.setConfigValue('settings.soul', { content });
            logger.info('SOUL.md 已迁移到 ConfigManager');
          }
        } catch (err) {
          logger.warn('SOUL.md 迁移失败', { error: String(err) });
        }
      }
    }

    // 迁移 USER.md
    const userConfig = configMgr.getConfigValue('settings.user') as
      | { content?: string }
      | undefined;
    if (!userConfig?.content) {
      const userPath = resolveUserProfilePath();
      if (existsSync(userPath)) {
        try {
          const content = readFileSync(userPath, 'utf-8');
          if (content.trim()) {
            configMgr.setConfigValue('settings.user', { content });
            logger.info('USER.md 已迁移到 ConfigManager');
          }
        } catch (err) {
          logger.warn('USER.md 迁移失败', { error: String(err) });
        }
      }
    }
  } catch (err) {
    // 迁移非关键，失败不影响启动
    logger.warn('SOUL/USER 迁移到 ConfigManager 失败', {
      error: String(err),
    });
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
  const onboardRetryFlag = getOnboardRetryFlagPath();
  const dataDir = getDataDir();

  if (existsSync(onboardedFlag)) {
    // 已有标记文件，检查 AI 状态
    if (await isAIConfigured()) {
      setOfflineMode(false);
    }
    return;
  }

  // 首次运行：.env 文件已在 ensureEnvFileExists() 中提前创建
  // 此处仅执行用户引导流程

  // 检查重试次数
  let retryCount = 0;
  if (existsSync(onboardRetryFlag)) {
    try {
      retryCount = parseInt(readFileSync(onboardRetryFlag, 'utf-8').trim(), 10);
    } catch (err) {
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
      } catch (err) {
        handleError(err, { module: 'core:onboard', action: 'cleanRetryFlag' });
      } // @ignore-catch: 清理重试标志文件，失败不影响流程
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
      } catch (err) {
        handleError(err, { module: 'core:onboard', action: 'cleanRetryFlag' });
      } // @ignore-catch: 清理重试标志文件，失败不影响流程
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
    } catch (err) {
      handleError(err, { module: 'core:onboard', action: 'writeRetryFlag' });
    } // @ignore-catch: 重试计数写入失败不影响主流程

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
    } catch (err) {
      // 非致命，部分终端可能不支持
    }
    try {
      process.stdout.write('\x1b]0;Liri\x07');
    } catch (err) {
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
        } catch (err) {
          // 进程不存在，锁文件过期，继续启动
          logger.info(`检测到过期锁文件 (PID: ${pid}，进程已不存在)，将覆盖`);
        }
      }
    } catch (err) {
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
    } catch (err) {
      // 清理失败不阻塞退出
    }
    // BUG-12 fix: 销毁 ContextManager（清空缓存 + engine KV + 上下文）
    try {
      contextManager.destroy();
    } catch (err) {
      // destroy 失败不阻塞退出
    }
  };

  process.on('exit', () => {
    cleanup();
    // Phase 2.7: 同步持久化 ContextStore（exit 事件不支持 async）
    serializeOnShutdownSync();
    // 同步 exit 事件不支持 async，fire-and-forget flush
    // @ignore-catch — 同步exit事件不支持async，日志flush fire-and-forget
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
  } catch (err) {
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
  // 初始化 ModelRouter 从 DB 加载任务分工
  await modelRouter.initFromDb();

  // 解析 --model 参数并设为全局模型
  const modelArg = parseModelFromArgs(options.args);
  if (modelArg) {
    // 将模型名转换为 UUID 存储，保持 DB 一致性
    try {
      const { modelPricingService } =
        await import('./ai/models/ModelPricingService');
      await modelPricingService.initialize();
      const record = await modelPricingService.getPricing(modelArg);
      const modelId = record?.id || modelArg;
      await modelRouter.setCurrentModel(modelId);
      if (record?.id) {
        logger.info(`CLI --model ${modelArg} → UUID ${record.id}`);
      }
    } catch (err) {
      await modelRouter.setCurrentModel(modelArg);
    }
  }

  const httpPort = parseHttpPortFromArgs(options.args) || 7890;
  process.env.LIRI_HTTP_PORT = String(httpPort);
  const useLegacyRepl = options.args?.includes('--legacy-repl') || false;
  const httpOnly = options.args?.includes('--http-only') || false;

  // 解析 --trust-level 参数（场景选择联动）
  const trustLevelArg = parseTrustLevelFromArgs(options.args);

  // 启动 HTTP 服务先于首次运行引导，使前端在终端阻塞时也能连接
  // 从独立 http-server 模块导入，避免与 repl.ts 的静态 import 链形成循环依赖
  const { startHTTPServer } = await import('./entrypoints/http-server');
  let httpService: Awaited<ReturnType<typeof startHTTPServer>> | null = null;
  try {
    httpService = await startHTTPServer(httpPort);
    process.env.LIRI_HTTP_STARTED = '1';
    logger.info(`HTTP 服务已启动: http://127.0.0.1:${httpPort}`);
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    logger.error('HTTP 服务启动失败，前端将无法连接', {
      error: errMsg,
      stack: e instanceof Error ? e.stack : undefined,
    });
    console.error(`\n[ERROR] HTTP 服务启动失败 (端口 ${httpPort}): ${errMsg}`);
    console.error('请检查:');
    console.error('  1. 端口是否被占用: netstat -ano | findstr :7890');
    console.error(`  2. 数据库路径是否可写: ${resolveDataDir()}`);
    console.error('  3. app/.env 文件是否存在且配置正确\n');
  }

  // --http-only 模式：仅启动 HTTP 服务，不进入 REPL
  if (httpOnly) {
    logger.info('HTTP-only 模式，HTTP 服务已在运行，等待信号退出');
    // http-only 模式在此等待信号，launchREPL 无法返回，launch() 末尾的
    // `LocalHTTPService._appReady = true`（main.ts 1408）不会执行，
    // 导致所有业务请求持续返回 503 "Service starting"。此处手动标记就绪。
    if (httpService) {
      try {
        const { LocalHTTPService } =
          await import('./infrastructure/http/LocalHTTPService.js');
        LocalHTTPService._appReady = true;
      } catch {
        // @ignore-catch — 就绪标记失败不影响进程存活
      }
    }
    // 保持进程存活，直到收到 SIGINT/SIGTERM
    await new Promise<void>((resolve) => {
      const onSignal = () => {
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);
        resolve();
      };
      process.on('SIGINT', onSignal);
      process.on('SIGTERM', onSignal);
    });
    return;
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

  // 初始化 Media 模块（注册 15 个媒体工具）
  try {
    const { MediaModule } = await import('./media/MediaModule');
    const mediaModule = new MediaModule();
    await mediaModule.onReady();
    logger.info('Media 模块工具注册完成');
  } catch (err) {
    logger.error('Media 模块初始化失败', { error: String(err) });
  }

  const { launchRepl } = await import('./entrypoints/repl');
  await launchRepl({
    httpPort,
    useLegacyRepl,
    preStartedHttp: httpService as
      | import('./entrypoints/http-server').LocalHTTPService
      | undefined,
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
 * 从 DB model_registry 查询已启用聊天模型，为 SmartRouter tiers 提供默认值。
 * 仅在用户未手动配置 tiers（config.models.router.tiers 为空）时起作用。
 *
 * 分类逻辑：
 * - simple / medium: 第一个启用的通用聊天模型
 * - complex / reasoning: 优先选含 reasoning capability 或名称含 reasoner/pro 的模型
 * - 排除非聊天模型（image_generation, embedding, tts 等）
 * - DB 查询失败或无可选模型时返回空（SmartRouter 走 fallback 链）
 */
async function resolveDefaultTiersFromDb(): Promise<
  Record<string, { model: string; providerHint: string }>
> {
  const emptyTiers = {
    simple: { model: '', providerHint: '' },
    medium: { model: '', providerHint: '' },
    complex: { model: '', providerHint: '' },
    reasoning: { model: '', providerHint: '' },
  };

  try {
    const { modelPricingService } =
      await import('@modules/ai/models/ModelPricingService');
    await modelPricingService.initialize();
    const allModels = await modelPricingService.getAllPricing();
    const enabled = allModels.filter((m) => m.enabled && m.modelId);
    if (enabled.length === 0) return emptyTiers;

    // 排除非聊天能力模型
    const nonChatCaps = [
      'image_generation',
      'video_generation',
      'embedding',
      'text_to_speech',
      'speech_recognition',
      'reranking',
      'moderation',
      'image_editing',
    ];
    const chatModels = enabled
      .filter((m) => m.enabled && m.modelId)
      .filter((m) => {
        // 排除无能力声明的残留模型（capabilities=[]，无法确定用途，
        // 曾被误选为 SmartRouter 档位导致决策异常）
        if (!m.capabilities || m.capabilities.length === 0) return false;
        if (m.capabilities.some((c) => nonChatCaps.includes(c))) return false;
        return true;
      });
    if (chatModels.length === 0) return emptyTiers;

    // 推理模型：capabilities 含 thinking/extended_thinking 或名称含 reasoner/reasoning/pro
    const reasoningModels = chatModels.filter(
      (m) =>
        m.capabilities?.includes('thinking') ||
        m.capabilities?.includes('extended_thinking') ||
        m.modelId.toLowerCase().includes('reasoner') ||
        m.modelId.toLowerCase().includes('reasoning') ||
        /-pro$/i.test(m.modelId)
    );

    const defaultModel = chatModels[0].modelId;
    const providerHint = chatModels[0].providerId || '';
    const reasoningModel =
      reasoningModels.length > 0 ? reasoningModels[0].modelId : defaultModel;

    logger.info('SmartRouter tiers 已从 DB 填充', {
      simple: defaultModel,
      medium: defaultModel,
      complex: reasoningModel,
      reasoning: reasoningModel,
    });

    return {
      simple: { model: defaultModel, providerHint },
      medium: { model: defaultModel, providerHint },
      complex: { model: reasoningModel, providerHint },
      reasoning: { model: reasoningModel, providerHint },
    };
  } catch (err) {
    logger.debug('从 DB 填充 tiers 失败，使用空默认值', {
      error: (err as Error).message,
    });
    return emptyTiers;
  }
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

  // 确保 .env 文件存在（所有模式通用，不限于 REPL）
  // 从 .env.example 自动创建，避免新环境部署时因缺少 .env 而启动失败
  ensureEnvFileExists();

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

    // 启动时关键依赖完整性校验（非阻塞，缺失时输出修复指引）
    checkCriticalDependencies();

    // 注册工具调用解析器（Hermes / InvokeXml / LlamaJson 等）
    // 必须在 TAORLoop / ChatManager 使用 parserRegistry.parseFallback() 前注册
    import('./ai/parsers/registerParsers.js')
      .then(({ registerAllParsers }) => registerAllParsers())
      .catch((err) => {
        logger.warning('工具调用解析器注册失败（非致命）', {
          error: String(err),
        });
      });

    // Phase 3 token-tracking-unification: 启动时预加载 tiktoken wasm
    // 不在首次 API 请求路径上 lazy init，失败时 30s 自动重试
    import('./ai/tokenizer/TiktokenEstimator.js')
      .then(({ preloadTiktoken }) => preloadTiktoken())
      .catch((err) => {
        logger.warning('Tiktoken 预加载失败（非致命）', { error: String(err) });
      });

    // T1: 模块系统初始化
    profileCheckpoint('module_init_start');
    profilePhaseStart('T1_module_init');

    // 灰度回退已移除
    if (process.env.LIRI_USE_LEGACY_MODULE_SYSTEM === '1') {
      logger.error('V1 旧版模块系统已移除。请使用默认 V2 路径启动。');
      process.exit(1);
    }

    // V2 统一路径：使用 DIContainer.bootstrap()
    // 显示加载提示（在 T1 执行期间给用户进度反馈）
    process.stdout.write('⏳ Liri 正在加载模块...\r');

    const { getDIContainer } = await import('./core/DIContainer');
    const { moduleRegistry } = await import('./modules/ModuleRegistry');
    await getDIContainer().bootstrap(moduleRegistry, {
      mode: options.mode,
      args: options.args,
      debug: options.debug,
      verbose: options.verbose,
    });

    // 清除加载提示行
    process.stdout.write('\x1b[K');

    // 模块初始化失败汇总（启动末尾统一报告）
    const initFailures: { module: string; error: string }[] = [];

    /** 统一的模块初始化包装器，失败时记录到 initFailures 而非静默吞异常 */
    async function wrapInit(
      module: string,
      fn: () => Promise<void>,
      opts?: { critical?: boolean; fallbackMsg?: string }
    ): Promise<void> {
      try {
        await fn();
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        initFailures.push({ module, error: errMsg });
        if (opts?.critical) {
          logger.error(`关键模块 ${module} 初始化失败，应用终止`, e as Error);
          process.exit(1);
        }
        logger.warning(
          `${module} 初始化失败（非致命${opts?.fallbackMsg ? `，${opts.fallbackMsg}` : ''}）`,
          e as Error
        );
      }
    }

    // 初始化 OTel 观测系统 + Trace 引擎（必选项）
    await wrapInit(
      'OTel',
      async () => {
        const { initializeOTelSystem } =
          await import('./core/AppCoreOTelHelper');
        await initializeOTelSystem();
      },
      { fallbackMsg: '已跳过' }
    );

    // 初始化 LLM 调用跟踪器（DB 持久化 + 历史数据恢复）
    await wrapInit(
      'LLMTracker',
      async () => {
        const { getLLMTracker } =
          await import('./monitoring/llm/getLLMTracker');
        await getLLMTracker().init();
      },
      { fallbackMsg: '使用内存模式' }
    );

    profilePhaseEnd('T1_module_init');
    profileCheckpoint('module_init_end');

    // Phase 2.7: 从 JSONL 恢复 ContextStore 持久化数据
    hydrateOnStartup().catch(() => {
      // 恢复失败不阻塞启动
    });

    // T1.2: 读取 LIRI_TRUSTED_WORKSPACE 环境变量，映射到 permission.trustedWorkspaces
    // 仅合并 trustedWorkspaces 字段，仅在 config.json 中无 trustedWorkspaces 配置时注入
    try {
      injectTrustedWorkspaceFromEnv(configManager);
    } catch (err) {
      // 非致命：env 读取失败时静默跳过（不记录到 initFailures，因依赖环境变量）
    }

    // T1.25: 加载模型配置
    await wrapInit('模型配置', async () => {
      const { ModelRegistry } =
        await import('@modules/ai/models/ModelRegistry');
      const registry = ModelRegistry.getInstance();

      // 初始化 DB（创建 model_registry 表、从 YAML 种子）
      const { modelPricingService } =
        await import('@modules/ai/models/ModelPricingService.js').catch(() => {
          return {
            modelPricingService:
              null as unknown as import('@modules/ai/models/ModelPricingService.js').ModelPricingService,
          };
        });
      if (modelPricingService) {
        await modelPricingService.initialize();
        const hasDbData = await registry.loadModelsFromDb();
        if (!hasDbData) {
          // DB 为空（首次运行），YAML 作为兜底
          registry.loadDefaultModels();
          registry.loadUserConfigs();
        }
      } else {
        // DB 不可用，YAML 作为兜底
        registry.loadDefaultModels();
        registry.loadUserConfigs();
      }
      await registry.loadDbPricing();
    });

    // T1.25.1: llama.cpp 集成（非阻塞启动；二进制缺失时后台下载，就绪后注册 provider）
    void (async () => {
      try {
        const { llamaCppServerManager } =
          await import('@modules/ai/local/llama/LlamaCppServerManager.js');
        await llamaCppServerManager.start();
        const status = await llamaCppServerManager.getStatus();
        if (status.running) {
          const { ensureLlamaCppProviderRegistered } =
            await import('@modules/ai/local/llama/registerLlamaCppProvider.js');
          await ensureLlamaCppProviderRegistered();
        }
      } catch (err) {
        await handleError(err, { module: 'ai:llama', action: 'startup' });
      }
    })();

    // T1.26: 初始化通知持久化（建表 + FTS5 + 过期调度）
    await wrapInit('NotificationPersistence', async () => {
      const { notificationPersistence } =
        await import('@modules/runtime/NotificationPersistence.js');
      await notificationPersistence().init();
    });

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
    import('./bridge/ModuleBridgeSetup.js')
      .then(({ setupModuleBridgeOnStartup }) => {
        setupModuleBridgeOnStartup().catch((err) => {
          logger.warning('ACP 模块桥接初始化异常（非致命）', {
            error: String(err),
          });
        });
      })
      .catch((err) => {
        logger.warning('ACP 模块桥接加载失败（非致命）', {
          error: String(err),
        });
      });

    // T1.8: 初始化 SmartRouter 智能路由（非阻塞，失败不影响主流程）
    await wrapInit(
      'SmartRouter',
      async () => {
        const { SmartRouter } = await import('@modules/ai/router/SmartRouter');
        const { providerRegistry } =
          await import('@modules/ai/providers/ProviderRegistry');
        const { configManager } = await import('@modules/config/ConfigManager');

        // 从 DB 动态获取 tiers 默认值（替代空字符串）
        const dbTiers = await resolveDefaultTiersFromDb();

        // 从 configManager 读取路由配置，若无则使用默认值
        const savedRouter = (configManager.getGlobalConfig().models?.router ??
          {}) as Partial<import('@modules/ai/router/types').RouterConfig>;
        const routerConfig: import('@modules/ai/router/types').RouterConfig = {
          enabled: savedRouter.enabled !== false,
          defaultTier: savedRouter.defaultTier || 'medium',
          sessionSticky: savedRouter.sessionSticky !== false,
          tiers: {
            simple: savedRouter.tiers?.simple ?? dbTiers.simple,
            medium: savedRouter.tiers?.medium ?? dbTiers.medium,
            complex: savedRouter.tiers?.complex ?? dbTiers.complex,
            reasoning: savedRouter.tiers?.reasoning ?? dbTiers.reasoning,
          },
          fallback: savedRouter.fallback,
          judge: savedRouter.judge,
          zeroUsageRetry: savedRouter.zeroUsageRetry,
          transientRetry: savedRouter.transientRetry,
          stats: savedRouter.stats,
        };

        const smartRouter = new SmartRouter({
          config: routerConfig,
          providerRegistry,
        });

        // 注入 CoreAPIImpl 全局单例
        const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');
        getCoreAPI().setSmartRouter(smartRouter);

        // 从 ConfigManager 或 settings.json 恢复用户自定义数据目录
        const { loadUserSettings } =
          await import('./config/settings/userSettings.js');
        const { setUserDataDirOverride } = await import('./core/paths.js');

        // 优先读取 ConfigManager（新），fallback settings.json（旧，自动迁移）
        let dataDirectory = configManager.getConfigValue(
          'system.dataDirectory'
        ) as string | undefined;
        if (!dataDirectory) {
          const settings = loadUserSettings();
          dataDirectory = settings.dataDirectory as string | undefined;
          // 自动迁移：settings.json → ConfigManager
          if (
            dataDirectory &&
            typeof dataDirectory === 'string' &&
            dataDirectory.trim()
          ) {
            configManager.setConfigValue(
              'system.dataDirectory',
              dataDirectory.trim()
            );
          }
        }
        if (
          dataDirectory &&
          typeof dataDirectory === 'string' &&
          dataDirectory.trim()
        ) {
          setUserDataDirOverride(dataDirectory.trim());
          logger.info(`用户数据目录已从设置恢复: ${dataDirectory}`);
        }

        // Phase 2.2: SOUL.md / USER.md → ConfigManager 自动迁移
        await migrateSoulAndUserToConfigManager(configManager);

        // 预热：确保会话从磁盘加载，HTTP handler 首次请求即可返回
        await getCoreAPI().ensureSessionsLoaded();
      },
      { fallbackMsg: '使用静态路由' }
    );

    // Phase 3: Connection Registry — 验证关键组件连接
    await wrapInit('ConnectionRegistry', async () => {
      const { connectionRegistry } =
        await import('./core/connections/ConnectionRegistry.js');
      connectionRegistry.verifyAll();
    });

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

    // 汇总报告：模块初始化失败（非致命）
    if (initFailures.length > 0) {
      logger.warning(`${initFailures.length} 个模块初始化失败（非致命）`, {
        modules: initFailures.map((f) => f.module),
        errors: initFailures.map((f) => f.error),
      });
    }

    // 标记应用已就绪，HTTP 服务开始接受业务请求
    try {
      const { LocalHTTPService } =
        await import('./infrastructure/http/LocalHTTPService.js');
      LocalHTTPService._appReady = true;
    } catch {
      // LocalHTTPService 导入失败不影响主流程
    }

    // PDCA 启动扫描：标记残留的运行中任务为 abort
    try {
      const { scanAndAbortStalePdcaTasks } =
        await import('./infrastructure/http/handlers/pdca-handlers.js');
      scanAndAbortStalePdcaTasks();
    } catch {
      // 扫描失败不影响主流程
    }

    profileReport();
  } catch (error) {
    // 增强错误日志：记录原始错误类型和栈信息
    logger.error('launch 捕获到未处理异常', {
      errorType: typeof error,
      errorName: (error as Error)?.name ?? 'N/A',
      errorMessage: (error as Error)?.message ?? String(error),
      errorStack: (error as Error)?.stack?.slice(0, 1000) ?? 'N/A',
      isErrorInstance: error instanceof Error,
    });

    await (
      await import('./error/handleError.js')
    ).handleError(error, { module: 'app:main', action: 'launch' });
    profileCheckpoint('launch_error');
    profileReport();

    // 写入启动错误日志供客户端读取展示
    try {
      const { writeFileSync } = await import('fs');
      const { join } = await import('path');
      const { resolveLogsDir } = await import('./core/paths.js');
      const logPath = join(resolveLogsDir(), 'startup-error.log');
      writeFileSync(
        logPath,
        `${new Date().toISOString()} 启动失败\n${String(error)}\n`
      );
    } catch (err) {
      /* 静默 */
    }

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

  // 首启种子数据同步（幂等）：把打包内种子模板落到用户数据目录
  syncSeedData();

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

  // 灰度回退已移除：--use-legacy-module-system 标志不再支持
  if (args.includes('--use-legacy-module-system')) {
    console.error('[ERROR] V1 旧版模块系统已移除，请使用默认 V2 路径启动。');
    process.exit(1);
  }

  await launch({ mode, args });
}

if (import.meta.main) {
  main();
}
