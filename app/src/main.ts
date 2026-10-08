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
} from '@modules/infrastructure';
import {
  installExitRecorder,
  logStartupContext,
  readLastExit,
  recordAbnormalExit,
} from '@modules/core';
import { initAppStateMachine } from './state/app/AppLifecycle.js';
import {
  startKeychainPrefetch,
  ensureKeychainPrefetchCompleted,
} from '@modules/infrastructure';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  unlinkSync,
  statSync,
} from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import {
  resolveProjectRoot,
  resolveDataDir,
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
import { hydrateOnStartup, serializeOnShutdownSync } from '@modules/context';
import { contextManager } from './context/ContextManager.js';
// AC-7：type-only 导入，信号处理中同步强关 HTTP（零运行时依赖，无循环引用）
import type { LocalHTTPService } from '@modules/infrastructure';
// 端口单一事实来源（默认值），运行时由 LIRI_HTTP_PORT 覆盖
import { DEFAULT_HTTP_PORT } from './core/ports.js';

/**
 * 当前实例的 HTTP 服务引用（AC-7）
 *
 * 信号处理（SIGINT/SIGTERM，注册于 checkSingletonInstance）需要第一时间
 * 同步释放监听端口：卡死在优雅退出链时，"无监听端口"是单实例锁判定
 * "退出中僵尸"的唯一可靠信号（健康实例必有 HTTP LISTENING）。
 * launchREPL 启动 HTTP 成功后赋值。
 */
let activeHttpService: LocalHTTPService | null = null;

import { getLogger, Logger } from '@modules/monitoring';
import { handleError } from '@modules/error';
// 「预期中断」判据（与循环侧 system_aborted 判定同源；见 `isAbortReason` 注释）
import { isAbortReason } from '@modules/query';
// 大文件拆分（spec file-size-debt-partition-plan）：启动前检查/首次引导已外迁至
// `bootstrap/preflight.ts`，此处仅导入复用；`isValidApiKey` 保留对外导出（纯再导出）。
import {
  ensureEnvFileExists,
  checkCriticalDependencies,
  migrateSoulAndUserToConfigManager,
  checkFirstRunAndOnboard,
} from './bootstrap/preflight.js';
export { isValidApiKey } from './bootstrap/preflight.js';
const logger = getLogger('main');

/**
 * 启动模式枚举
 */
export enum LaunchMode {
  // D-229：`CLI = 'cli'` 成员已删 —— 全仓无设置点，唯一消费者 `entrypoints/cli.tsx` 已移除。
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
 * 同步等待（Atomics.wait 阻塞事件循环，用于启动期同步流程）
 */
function syncSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 检测指定 PID 是否监听着任意 TCP 端口（仅 Windows）
 *
 * AC-7（2026-08-20）：用于区分"健康服务实例"（REPL/DAEMON 模式必有 HTTP LISTENING）
 * 与"退出中僵尸"（优雅退出流程已关闭 HTTP server 但进程未死透）。
 *
 * @returns true=在监听 / false=无监听 / netstat 执行失败时返回 true（保守视为健康，避免误杀）
 */
function isProcessListeningOnAnyPort(pid: number): boolean {
  if (process.platform !== 'win32') {
    // 非 Windows 平台无可靠同步检测手段，保守视为健康
    return true;
  }
  try {
    const out = execSync('netstat -ano -p tcp', {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    });
    const pidRe = new RegExp(`\\s${pid}\\s*$`);
    return out
      .split('\n')
      .some((line) => line.includes('LISTENING') && pidRe.test(line));
  } catch (err) {
    logger.warning('netstat 端口检测失败，保守视为健康实例', {
      pid,
      error: String(err),
    });
    return true;
  }
}

/**
 * 终止退出中的僵尸实例（AC-7）
 *
 * 场景：bun --watch 文件变更重启时，旧进程收到信号后优雅退出链
 * （通道 dispose / flush）可能卡死——HTTP 已关、进程未死。此时新实例
 * 需接管而非退出，否则服务下线。
 *
 * 流程：SIGTERM → 3s 优雅窗口 → 仍存活则 SIGKILL → 2s 确认死亡。
 *
 * @returns true=僵尸已清理可接管 / false=无法终止（调用方应退出）
 */
function terminateZombieInstance(pid: number): boolean {
  const t0 = Date.now();
  logger.warning(
    `检测到疑似僵尸实例 (PID: ${pid}，进程存活但无监听端口，疑似卡在优雅退出流程)，尝试清理后接管`,
    { pid, currentPid: process.pid }
  );
  // 第一步：SIGTERM 优雅终止（健康 CLI/MCP 等无端口实例也会正常退出，属替换语义）
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return true; // 已死亡
  }
  for (let i = 0; i < 15; i++) {
    syncSleep(200);
    try {
      process.kill(pid, 0);
    } catch {
      logger.info(`僵尸实例已通过 SIGTERM 退出 (${Date.now() - t0}ms)`, {
        pid,
      });
      return true;
    }
  }
  // 第二步：SIGKILL 强杀（Windows 上等价 TerminateProcess）
  logger.warning(
    `僵尸实例 SIGTERM 后 ${Date.now() - t0}ms 未退出，升级 SIGKILL`,
    {
      pid,
    }
  );
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    return true;
  }
  for (let i = 0; i < 10; i++) {
    syncSleep(200);
    try {
      process.kill(pid, 0);
    } catch {
      logger.warning(
        `僵尸实例已被 SIGKILL 终止 (总耗时 ${Date.now() - t0}ms)`,
        {
          pid,
        }
      );
      return true;
    }
  }
  logger.error(`无法终止僵尸实例 (PID: ${pid})，放弃接管`, {
    pid,
    elapsedMs: Date.now() - t0,
  });
  return false;
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
          // AC-7（2026-08-20）：存活需区分两种情况——
          // ① 健康实例：有 LISTENING 端口（REPL/DAEMON 的 HTTP 服务）→ 保持原语义退出
          // ② 退出中僵尸：bun --watch 重启时旧进程卡在优雅退出链（锁已删、HTTP 已关、
          //    进程未死）→ 清理僵尸后接管，避免双实例导致 QQ WS 归属错乱、消息静默丢失
          if (isProcessListeningOnAnyPort(pid)) {
            logger.warning(
              `检测到已有健康实例在运行 (PID: ${pid}，端口监听中)，当前实例将退出`
            );
            process.exit(1);
          }
          if (!terminateZombieInstance(pid)) {
            logger.warning(
              `已有实例 (PID: ${pid}) 无法终止，当前实例将退出（请手动检查该进程）`
            );
            process.exit(1);
          }
          // 僵尸已清理：持久化痕迹（复用异常退出记录，含僵尸场景标识）后继续启动
          recordAbnormalExit({
            detectedAt: new Date().toISOString(),
            stalePid: pid,
            lastLockedAt: null,
            lastExit: readLastExit(),
          });
          logger.warning(
            `僵尸实例 (PID: ${pid}) 已清理，当前实例 (PID: ${process.pid}) 接管并继续启动`
          );
          // 跳过下方的"进程不存在残留"处理，直接进入写锁阶段
        } catch (err) {
          // 进程不存在 → 锁文件残留。正常退出必然在 exit 事件清理锁文件（cleanup），
          // 残留即上次进程未走正常退出（强杀/崩溃/断电）。
          // #57-3 可观测性：详细结构化日志 + 持久化痕迹（last-abnormal.json），事后可溯源
          const detectedAt = new Date().toISOString();
          let lockStat: {
            mtime: string | null;
            ctime: string | null;
            size: number | null;
          } = {
            mtime: null,
            ctime: null,
            size: null,
          };
          try {
            const s = statSync(lockFile);
            lockStat = {
              mtime: s.mtime.toISOString(),
              ctime: s.ctime.toISOString(),
              size: s.size,
            };
          } catch {
            /* stat 失败不阻断启动 */
          }
          const lastExit = readLastExit();
          recordAbnormalExit({
            detectedAt,
            stalePid: pid,
            lastLockedAt: lockStat.mtime,
            lastExit,
          });
          logger.warning(
            `上次进程异常退出（锁文件残留，未走正常退出清理）：PID ${pid}` +
              (lockStat.mtime ? `，最后活动 ${lockStat.mtime}` : '') +
              (lastExit
                ? `；最近退出记录 reason=${lastExit.reason} code=${lastExit.code} at=${lastExit.exitAt}`
                : '；无 last-exit.json（强杀/断电，未触发任何退出事件）') +
              `。已记录到 last-abnormal.json，当前实例将覆盖并继续启动`,
            {
              // 详细上下文：锁文件状态 / 退出记录 / 运行环境
              lockFile,
              stalePid: pid,
              lockMtime: lockStat.mtime,
              lockCtime: lockStat.ctime,
              lockSize: lockStat.size,
              lastExit: lastExit ?? null,
              detectedAt,
              currentPid: process.pid,
              uptimeMs: Math.round(process.uptime() * 1000),
              dataDir,
              abnormalRecordPath: join(dataDir, 'last-abnormal.json'),
            }
          );
        }
      }
    } catch (err) {
      // 锁文件内容异常，忽略并覆盖（记录文件状态与内容摘要便于排查）
      let lockStat: { mtime: string | null; size: number | null } = {
        mtime: null,
        size: null,
      };
      try {
        const s = statSync(lockFile);
        lockStat = { mtime: s.mtime.toISOString(), size: s.size };
      } catch {
        /* stat 失败不阻断启动 */
      }
      let rawPreview: string | null = null;
      try {
        rawPreview = readFileSync(lockFile, 'utf-8').slice(0, 100);
      } catch {
        /* 读取失败不阻断 */
      }
      logger.warning('锁文件内容异常，将覆盖', {
        lockFile,
        lockMtime: lockStat.mtime,
        lockSize: lockStat.size,
        rawPreview: rawPreview ?? null,
        detectedAt: new Date().toISOString(),
        currentPid: process.pid,
      });
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
    // AC-7（2026-08-20）：不在信号处理中提前执行 cleanup（删锁）。
    // 若优雅退出链（通道 dispose/flush）卡死，锁已删而进程未死 →
    // 新实例无法检测到旧实例 → 双实例并存（QQ WS 归属错乱、消息丢失）。
    // 删锁统一延迟到 process.exit 触发的 'exit' 事件（必然同步执行）；
    // 卡死时锁保留，供新实例按僵尸流程检测并接管。
    // 同步强关 HTTP：立即释放端口（新实例可绑定）+"无监听端口"成为
    // 退出中僵尸的可靠信号（closeAllConnections 防 keep-alive 拖住）。
    activeHttpService?.forceCloseSync();
    // T3.4: 优雅退出释放通道级 scope（注销已注册通道）
    // T1.25.4: 并行停止 llama-server（生命周期同步；allSettled 保证任一失败互不影响）
    void Promise.allSettled([
      gracefulChannelShutdown(),
      gracefulLlamaShutdown(),
      // 优雅退出（2026-09-02 排查"会话中断"补充）：先 flush 全会话事件缓冲
      // （text-batch 落盘），避免 watch 重启/Ctrl+C 中断在途会话留下 torn/open-turn
      import('./chat/ChatManager.js')
        .then((m) => m.flushAllEventBuffers())
        .catch(() => 0),
      // M4（2026-09-17）：优雅退出前为可中断会话写 cleanShutdown 标记——下次启动跳过崩溃恢复
      import('./chat/ChatManager.js')
        .then((m) => m.markSessionsCleanShutdown())
        .catch(() => 0),
    ]).then(() => flush().finally(() => process.exit(0)));
  });
  process.on('SIGTERM', () => {
    // 同上：删锁延迟到 exit 事件；先同步强关 HTTP（AC-7）
    activeHttpService?.forceCloseSync();
    void Promise.allSettled([
      gracefulChannelShutdown(),
      gracefulLlamaShutdown(),
      // 优雅退出（2026-09-02 排查"会话中断"补充）：先 flush 全会话事件缓冲
      // （text-batch 落盘），避免 watch 重启/Ctrl+C 中断在途会话留下 torn/open-turn
      import('./chat/ChatManager.js')
        .then((m) => m.flushAllEventBuffers())
        .catch(() => 0),
      // M4（2026-09-17）：优雅退出前为可中断会话写 cleanShutdown 标记
      import('./chat/ChatManager.js')
        .then((m) => m.markSessionsCleanShutdown())
        .catch(() => 0),
    ]).then(() => flush().finally(() => process.exit(0)));
  });
}

/**
 * T3.4: 通道级 scope 释放（注销 bootstrap 注册的通道）。
 * dynamic import 避免 main.ts 与 channels 模块静态耦合。
 */
async function gracefulChannelShutdown(): Promise<void> {
  // 先停渠道实时监控（清探测循环与退避定时器），再释放通道 scope
  const { getChannelRealtimeMonitor } =
    await import('./channels/monitoring/ChannelRealtimeMonitor');
  getChannelRealtimeMonitor().stop();
  const { channelBootstrapper } =
    await import('./channels/bootstrap/ChannelBootstrapper');
  await channelBootstrapper.disposeAll();
}

/**
 * T1.25.4: 退出时停止 llama-server（与 Liri 生命周期同步）。
 * 防止应用退出后 llama-server 进程残留（占内存、后台继续生成导致下次请求 busy 误判）。
 * dynamic import 避免 main.ts 与 llama 模块静态耦合；失败不阻塞退出。
 */
async function gracefulLlamaShutdown(): Promise<void> {
  try {
    const { llamaCppServerManager } =
      await import('@modules/ai/local/llama/LlamaCppServerManager.js');
    await llamaCppServerManager.stop();
  } catch (err) {
    // @ignore-catch — llama 模块加载/停止失败不阻塞应用退出
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
  } catch (err) {
    // 健康报告展示失败不影响主流程
  }
}

// 2026-10-02 D-229：`setCliMain` / `_cliMain` / `launchCLI`（连同下方 `LaunchMode.CLI` 分支）**已删除** ——
// 唯一调用方 `entrypoints/cli.tsx` 经取证为**死代码**（`LaunchMode.CLI` 全仓无设置点 ⇒ `launchCLI` 不可达；
// 该文件零导入、两个导出零消费者、直跑挂起），已连同 `entrypoints/cliArgs.ts` 一并移除。
// 未识别/未知模式仍由下方 `switch` 的 `default` 回落 REPL。

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

  // HTTP 端口优先级：命令行 --http-port > 环境变量 LIRI_HTTP_PORT > 默认 18990
  // （Docker 部署通过 LIRI_HTTP_PORT=3000 注入，避免硬编码默认值）
  // 18990 避开 Clash/V2Ray 等代理软件默认端口 7890
  const httpPort =
    parseHttpPortFromArgs(options.args) ||
    parseInt(process.env.LIRI_HTTP_PORT ?? '', 10) ||
    DEFAULT_HTTP_PORT;
  process.env.LIRI_HTTP_PORT = String(httpPort);
  // 监听地址：默认 127.0.0.1（本地/桌面场景），Docker 部署设置 LIRI_HTTP_HOST=0.0.0.0
  const httpHost = process.env.LIRI_HTTP_HOST?.trim() || '127.0.0.1';
  const useLegacyRepl = options.args?.includes('--legacy-repl') || false;
  const httpOnly = options.args?.includes('--http-only') || false;

  // 解析 --trust-level 参数（场景选择联动）
  const trustLevelArg = parseTrustLevelFromArgs(options.args);

  // 启动 HTTP 服务先于首次运行引导，使前端在终端阻塞时也能连接
  // 从独立 http-server 模块导入，避免与 repl.ts 的静态 import 链形成循环依赖
  const { startHTTPServer } = await import('./entrypoints/http-server');
  let httpService: Awaited<ReturnType<typeof startHTTPServer>> | null = null;
  try {
    httpService = await startHTTPServer(httpPort, httpHost);
    // AC-7：暴露给信号处理（同步强关端口，见 forceCloseSync 注释）
    activeHttpService = httpService;
    process.env.LIRI_HTTP_STARTED = '1';
    logger.info(`HTTP 服务已启动: http://${httpHost}:${httpPort}`);
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    logger.error('HTTP 服务启动失败，前端将无法连接', {
      error: errMsg,
      stack: e instanceof Error ? e.stack : undefined,
    });
    console.error(`\n[ERROR] HTTP 服务启动失败 (端口 ${httpPort}): ${errMsg}`);
    console.error('请检查:');
    console.error(`  1. 端口是否被占用: netstat -ano | findstr :${httpPort}`);
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
    const { MediaModule } = await import('./tools/media/MediaModule');
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
 * 启动完成汇总（2026-09-29，台账「另案 ⑦」）。
 *
 * **为什么抽成函数**：DAEMON 模式下 `launch()` 的**尾部永不执行** —— `launchDaemon()` 末尾
 * `await new Promise(...)` 永久挂起等待 SIGINT/SIGTERM ⇒ 原本写在 `launch()` 尾部的
 * 「启动完成 + 阶段耗时 + 模块初始化失败汇总 + `_appReady` 兜底 + `profileReport()`」
 * 在 DAEMON 下**从未产出**（实测：daemon 启动日志无「启动完成」行）。
 * 现由两处调用：① `launch()` 尾部（CLI/REPL/MCP/TEST）；② `launchDaemon()` 就绪点。
 *
 * @param initFailures 模块初始化失败清单（仅 `launch()` 持有；DAEMON 调用点传空数组）
 */
async function reportBootCompletion(
  initFailures: Array<{ module: string; error: string }> = []
): Promise<void> {
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

  // 标记应用已就绪，HTTP 服务开始接受业务请求（幂等：DAEMON 下 launchDaemon 已设过一次）
  try {
    const { LocalHTTPService } =
      await import('./infrastructure/http/LocalHTTPService.js');
    LocalHTTPService._appReady = true;
  } catch {
    // @ignore-catch: LocalHTTPService 导入失败不影响主流程
  }

  profileReport();
}

/**
 * 启动后台守护进程模式
 * @deprecated 启动路径已统一到 ModuleRegistry.bootstrap()。
 * init() 由 bootstrap() 内部调用，此函数仅保留模式分发逻辑。
 */
async function launchDaemon(options: LaunchOptions): Promise<void> {
  logger.info('后台守护进程模式启动（常驻模式，不启动 REPL 交互）');

  // DAEMON 模式复用与 REPL 完全一致的 HTTP 启动链路（端口解析优先级、startHTTPServer）：
  //   CLI --http-port > env LIRI_HTTP_PORT > 默认 18990
  // 之前走 launchRepl(useLegacyRepl=true) 的问题：后台 no-tty 下 stdin EOF 立即触发
  //   REPL 退出 → launchDaemon return → HTTP 没 listen 进程就自杀 → 前端 127.0.0.1:18990 连不上
  const httpPort =
    parseHttpPortFromArgs(options.args) ||
    parseInt(process.env.LIRI_HTTP_PORT ?? '', 10) ||
    DEFAULT_HTTP_PORT;
  process.env.LIRI_HTTP_PORT = String(httpPort);
  const httpHost = process.env.LIRI_HTTP_HOST?.trim() || '127.0.0.1';

  const { startHTTPServer } = await import('./entrypoints/http-server');
  let httpService: Awaited<ReturnType<typeof startHTTPServer>> | null = null;
  try {
    httpService = await startHTTPServer(httpPort, httpHost);
    activeHttpService = httpService;
    process.env.LIRI_HTTP_STARTED = '1';
    logger.info(`HTTP 服务已启动: http://${httpHost}:${httpPort}`);
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    logger.error('DAEMON 模式 HTTP 服务启动失败', {
      error: errMsg,
      stack: e instanceof Error ? e.stack : undefined,
    });
    console.error(
      `\n[ERROR] DAEMON HTTP 启动失败 (端口 ${httpPort}): ${errMsg}`
    );
  }

  // DAEMON 语义等价于 --http-only：HTTP 就绪后手动标记 _appReady（否则请求 503）
  if (httpService) {
    try {
      const { LocalHTTPService } =
        await import('./infrastructure/http/LocalHTTPService.js');
      LocalHTTPService._appReady = true;
    } catch {
      // @ignore-catch — 就绪标记失败不影响进程存活；下方 `reportBootCompletion()` 会再设一次
      //（2026-09-29 台账「另案 ⑦」：原注释称"launch() 末尾会再设一次兜底"，但 DAEMON 下
      // `launch()` 尾部**永不执行** ⇒ 那个兜底并不存在，故改为本模式内的自兜底）
    }
  }

  // DAEMON 常驻模式下启动全局 Cron 调度器（此前 DAEMON 只起 HTTP，定时任务全挂）
  // KB-CRON-DAEMON（2026-08-29）：复用 startCronEngine（REPL 同款 AI 执行器 + SQLite 持久化）
  try {
    const { startCronEngine } = await import('./tasks/cron/startCronEngine');
    const cronEngineResult = await startCronEngine();
    if (cronEngineResult.realExecutor) {
      logger.info('Cron 调度器已启动（AI 执行引擎就绪）', {
        providerName: cronEngineResult.providerName,
      });
    } else {
      logger.warn('Cron 调度器已启动（默认执行模式 — 无 AI Provider 可用）');
    }
  } catch (err) {
    // @ignore-catch — cron 启动失败不阻塞 DAEMON 常驻
    logger.error('Cron 调度器启动失败', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 启动完成汇总（2026-09-29，台账「另案 ⑦」）：DAEMON 下 `launch()` 尾部**永不执行**
  //（本函数末尾 `await new Promise` 永久挂起）⇒ 若不在此产出，「启动完成 / 阶段耗时 /
  // 就绪兜底 / profileReport」在 DAEMON 下永远不会出现。此点即 DAEMON 的"启动完成"时刻
  //（HTTP 与 Cron 均已就绪）。
  // 注：此刻 `T2_dispatch` / `launch_total` 两阶段尚未 end（由 `launch()` 尾部收尾）⇒
  // 汇总中不含这两项，属已知口径差异。
  await reportBootCompletion();

  // 永远挂住直到 SIGINT/SIGTERM
  logger.info('DAEMON 模式常驻：等待信号退出（SIGINT/SIGTERM）');
  await new Promise<void>((resolve) => {
    const onSignal = () => {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      resolve();
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
  });
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
 * N-40（2026-09-20）：按「任务分工」解析首选聊天模型（`chat` → `default`）。
 *
 * 背景：档位默认模型原取 `chatModels[0]`，而 `ModelPricingService.getAllPricing()` 是
 * `SELECT * FROM model_registry ORDER BY model_id ASC` —— **modelId 以数字开头的模型会排到
 * 最前**（实测首行为 `246676332` 的私有化模型）⇒ 与任务分工无关的模型被当成 simple/medium
 * 档位默认 ⇒ 动态路由把该 modelId 原样发给其 provider（不认该名字）⇒ 400。
 * 用户回合因前端显式带 model 可绕过，**后端发起的回合（系统续跑等）不指定 model 则必踩**。
 *
 * 配置表存的是 `model_registry.id`（UUID），此处映射回 modelId；同时兼容历史/手工写入的
 * 模型名。取不到返回 null（调用方回退"首个聊天模型"启发式）。
 */
async function resolveTaskConfiguredChatModel<
  T extends { id: string; modelId: string },
>(allModels: T[]): Promise<T | null> {
  try {
    const { appModelConfigService } = await import('@modules/ai');
    await appModelConfigService.initialize();
    for (const appType of ['chat', 'default']) {
      const configured = await appModelConfigService.getModel(appType);
      if (!configured) continue;
      const hit =
        allModels.find((m) => m.id === configured) ??
        allModels.find((m) => m.modelId === configured);
      if (hit) return hit;
    }
  } catch {
    // @ignore-catch 任务分工读取失败不阻断启动 → 调用方回退首行启发式
  }
  return null;
}

/**
 * 从 DB model_registry 查询已启用聊天模型，为 SmartRouter tiers 提供默认值。
 * 仅在用户未手动配置 tiers（config.models.router.tiers 为空）时起作用。
 *
 * 分类逻辑：
 * - simple / medium: 「任务分工」配置的 chat（→ default）模型；取不到才回退"首个启用的通用聊天模型"
 *   （N-40：原直接取首个，受 `ORDER BY model_id` 影响，数字开头的 modelId 会被误选）
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
    const { modelPricingService } = await import('@modules/ai');
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

    // N-40：优先按「任务分工」取默认档位模型（统一决策、数出同源）；
    // 取不到才回退"首个聊天模型"启发式（该启发式受 ORDER BY model_id 影响，顺序不稳定）
    const baseModel =
      (await resolveTaskConfiguredChatModel(enabled)) ?? chatModels[0];
    const defaultModel = baseModel.modelId;
    const providerHint = baseModel.providerId || '';
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

  // 根因 C：退出信息记录 — 启动时输出上次退出信息（区分手动 vs 崩溃），
  // 并注册退出监听（beforeExit/信号/异常），记录到 ~/.pyapp/data/last-exit.json
  installExitRecorder();
  logStartupContext();

  // §十 阶段 A：AppStateMachine 接线（注册 + 快照恢复 + 状态变更落盘）
  // 崩溃恢复/后台任务等关键节点通过 AppLifecycle 驱动全局状态
  initAppStateMachine();

  // 项3（会话排查 2026-08-13）：崩溃转储——uncaughtException/unhandledRejection 时
  // 同步写崩溃现场到 ~/.pyapp/data/crashes/crash-<ts>.json，补充日志留存的取证能力
  // （进程信息/堆栈/内存/参数），与日志留存等价满足取证需求。
  // 同步写：崩溃时事件循环可能即将终止，异步落盘不可靠。
  function writeCrashDump(
    type: 'uncaughtException' | 'unhandledRejection',
    error: unknown
  ): void {
    try {
      const dir = join(resolveDataDir(), 'crashes');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const file = join(dir, `crash-${ts}.json`);
      const err = error instanceof Error ? error : new Error(String(error));
      const dump = {
        timestamp: new Date().toISOString(),
        type,
        pid: process.pid,
        platform: process.platform,
        nodeVersion: process.version,
        uptimeMs: Math.round(process.uptime() * 1000),
        message: err.message,
        stack: err.stack,
        raw: String(error),
        memory: process.memoryUsage(),
        argv: process.argv,
      };
      writeFileSync(file, JSON.stringify(dump, null, 2), 'utf8');
      // 排查日志：转储写入成功（崩溃边缘用 console 而非 logger，避免依赖未初始化的模块）
      console.error(
        `[crash-dump] 崩溃转储已写入: ${file}（${type}，错误: ${err.message.slice(0, 200)}，${dump.stack ? `堆栈长度 ${dump.stack.length} 字符` : '无堆栈'}）`
      );
    } catch (e) {
      // 转储失败不阻塞原有兜底逻辑，仅输出 stderr
      console.error('[crash-dump] 写入崩溃转储失败', e);
    }
  }

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

      writeCrashDump('uncaughtException', error);
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
      // ABORT-HANDLER（2026-08-30）：AbortError 是用户停止/会话切换/压缩超时等
      // 预期中断在 abort 风暴（多流 promise 同时 settle）时产生的孤儿 rejection，
      // 非缺陷（实测循环期间 05:34 一次）。降级 warn 记录，不报 ErrorTracker——
      // 避免"正常取消操作"被误报为错误污染告警；@ignore-catch 等价说明（预期路径）。
      //
      // 判据收敛（2026-09-25，据 `dev_docs/error_repairs/last-exit-20260925-0154Z.md` 溯源）：
      // 原实现**内联**判据只认 `DOMException`/`Error` 形态 ⇒ **裸字符串**
      // `SYSTEM_ABORT_REASON`（`abort(reason)` 传字符串时该字符串本体会作为 rejection
      // reason 外泄）漏判，被误记为真异常（崩溃转储 + UNHANDLED_ERROR/medium）。
      // 现统一走 `@modules/query` 的 `isAbortReason()`（单一事实源，与循环侧的
      // `system_aborted` 判定同源），并保持"不放过任意含 abort 的字符串"的收窄口径。
      if (isAbortReason(reason)) {
        // ② 收口（2026-09-25，`.trae/specs/system-abort-reason-hardening.md` §6.5 缺口）：
        // 该分支**不再写崩溃转储**（① 的意图），若只记 `String(reason)` 则**不含 stack** ⇒
        // ② 让 reason 携带的栈在运行时**无处可见**。故此处补记 stack：`String(undefined)`
        // 之外的唯一可定位出口，且仅在 reason 本身是 Error 时才有（字符串形态无栈）。
        logger.warn('unhandledRejection（AbortError 预期中断）', {
          reason: String(reason),
          ...(reason instanceof Error && reason.stack
            ? { stack: reason.stack }
            : {}),
        });
        return;
      }

      writeCrashDump('unhandledRejection', reason);
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
      // 2026-09-30（D-127，`R00-003` ⑤）：环境初始化回调**由入口注入**。
      // ⚠️ 保持**惰性**（回调内部再动态导入 ⇒ 不在顶层 import init.ts）⇒ **启动时序不变**；
      // 目的：消除 `modules`（app）反调 `entrypoints`（entry）的跨层引用。
      initializeEnvironment: async () => {
        const { init } = await import('./entrypoints/init');
        await init();
      },
      // 2026-09-30（D-128，`R00-003` ② 改造）：SPI 实现**由入口推送注册**（惰性）
      // 实现体在 entry 侧装配模块构建 ⇒ 消除 `core/spi/*` 反向导入 app/service 的跨层对；
      // 回调由 DIContainer 在**原注册点**调用 ⇒ 注册时机不变。
      registerSpis: async (container) => {
        const { registerAllSpis } = await import('./entrypoints/spiWiring');
        await registerAllSpis(container);
      },
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
        // 2026-09-30 路径随归属搬迁更新（`core/` → entry 层 `bootstrap/`，台账 D-82）
        const { initializeOTelSystem } =
          await import('./bootstrap/AppCoreOTelHelper');
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
      const { ModelRegistry } = await import('@modules/ai');
      const registry = ModelRegistry.getInstance();

      // 初始化 DB（创建 model_registry 表、从 YAML 种子）
      const { modelPricingService } = await import('@modules/ai').catch(() => {
        return {
          modelPricingService:
            null as unknown as import('@modules/ai').ModelPricingService,
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
        const cfg = llamaCppServerManager.getConfig();
        if (!cfg.autoStart) {
          logger.info('llama.cpp autoStart=false，跳过自动启动');
          return;
        }
        if (!cfg.model) {
          logger.info('llama.cpp 未配置 GGUF 模型，跳过自动启动');
          return;
        }
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

    // T1.25.2: Ollama 集成（非阻塞；服务可用时注册 provider 并同步本地真实模型）
    void (async () => {
      try {
        const { ensureOllamaProviderRegistered } =
          await import('@modules/ai/local/ollama/registerOllamaProvider.js');
        await ensureOllamaProviderRegistered();
      } catch (err) {
        await handleError(err, { module: 'ai:ollama', action: 'startup' });
      }
    })();

    // T1.25.3: 官方价格自动同步（非阻塞、幂等；仅更新已注册模型价格，不覆盖手工配置）
    void (async () => {
      try {
        const { applyOfficialPricing } =
          await import('@modules/ai/config/official-pricing.js');
        await applyOfficialPricing();
      } catch (err) {
        await handleError(err, {
          module: 'ai:pricing:official',
          action: 'startup-sync',
        });
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
        const { SmartRouter } = await import('@modules/ai');
        const { providerRegistry } = await import('@modules/ai');
        const { configManager } = await import('@modules/config');

        // 从 DB 动态获取 tiers 默认值（替代空字符串）
        const dbTiers = await resolveDefaultTiersFromDb();

        // 从 configManager 读取路由配置，若无则使用默认值
        const savedRouter = (configManager.getGlobalConfig().models?.router ??
          {}) as Partial<import('@modules/ai').RouterConfig>;
        const routerConfig: import('@modules/ai').RouterConfig = {
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

        // U7/§21.4（2026-10-06，用户裁定「接线」）：注入**会话黏性存储** —— 开启
        // `SmartRouter.decide()` 层 3（同会话命中即**跳过 LLM Judge**，复用上次档位）。
        // 唯一构造点 = `ai/router/SessionRouterStore.ts#getSessionRouterStore`；
        // 初始化失败 ⇒ 返回 null ⇒ 退回"每轮 Judge"（= 接线前行为，不影响正确性）。
        // 用户显式配置的任务分工**不受影响**（`resolveModelRoute` 先查用户显式配置，
        // 见 `ai/router/resolveModelRoute.ts:52-101`）；可由 `models.router.sessionSticky:false` 关闭。
        const { getSessionRouterStore } =
          await import('./ai/router/SessionRouterStore.js');
        const sessionStore = await getSessionRouterStore();

        const smartRouter = new SmartRouter({
          config: routerConfig,
          providerRegistry,
          ...(sessionStore ? { sessionStore } : {}),
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

    // CG3 自主执行闭环接线（N-43，2026-09-20）：`startCg3()` 此前**全仓零调用** ⇒
    // `SelfWakeService` / `AlwaysOnManager` 从未实例化，导致：
    //   ① `sleep_for` / `sleep_until`（N-37 已注册进模型工具清单）执行时必然失败
    //      （实测返回"SelfWake 服务未初始化（CG3 未启动）"）；
    //   ② N-26 修好的「SelfWake.fire() → 会话续跑」没有任何触发场景
    //      （`CronScheduler.extraTick → getDueWakes()` 这条线也不存在）。
    // 注：①`CronScheduler` 尚未启动时 `wireSelfWakeToCron` 会告警并返回 false ——
    // 短时唤醒（`seconds×1000 < tickInterval`）走 setTimeout，不受影响；
    //  ②AlwaysOn 侧仅完成连线：其 runtimes 由 `registerProject()` 创建、当前无任何注册
    //    ⇒ `notifyUserActivity()` 遍历空集合，**不会产生自主行为**。
    //  2026-10-08（架构治理 P1 续）：AlwaysOn 侧原**未注入**的 `cmdBridge` / `watchdog` 已删除
    //  （取证：`AlwaysOnManager.registerProject()` 唯一构造点只传 2 参；且 P1-9 队列
    //  `MessageCommandQueue` 的消费端从未移植 ⇒ 无 drainer）。**P1-9 入队链随之移除**，
    //  重启条件见 `AlwaysOnRuntime.tryRun()` 注释。
    await wrapInit('Cg3', async () => {
      const { startCg3 } = await import('@modules/tasks/Cg3Bootstrap');
      const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');
      await startCg3(getCoreAPI().getChatManager());
    });

    // B1-3 / B1-4（2026-09-22 / 方案 §11 第 1 步）：**启动期 yield 恢复装配**。
    // 修复前装配只发生在 `streamMessage` / `sendMessage` 入口 ⇒ **无人发消息时
    // `agent_settlement_outbox` 的 `pending` 行永不回放**（O8 台账只写不生效）；
    // 且等待集不落盘 ⇒ 回放必然找不到等待者（逐次 markFailed ⇒ dropped）。
    //
    // P2-7（2026-09-25）：改由**恢复编排入口**统一承担 —— 一个 `wrapInit('Recovery')` 内按
    // `sessionCrash → [sessionState] → yieldRecovery → lineage` 顺序编排并输出**聚合报告**
    // （`sessionState` 全量重建默认跳过，避免拖慢启动；设计见 `.trae/specs/recovery-orchestration.md`）。
    await wrapInit('Recovery', async () => {
      const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');
      await getCoreAPI().getChatManager().bootstrapRecovery();
    });

    // PDCA：检查点索引**异步预热** + 启动扫描（标记残留的运行中任务为 abort）
    //
    // ⚠️ 位置很关键（2026-09-29 实测，台账「另案 ⑦」）：必须放在**模式分发之前** ——
    // DAEMON 模式在 `launchDaemon()` 末尾 `await new Promise(...)` **永久挂起**（等
    // SIGINT/SIGTERM）⇒ `launch()` **尾部代码在 DAEMON 下永不执行**（实测 daemon 启动日志
    // 无「启动完成」行）。原实现把该扫描放在尾部 ⇒ **DAEMON 模式下从未执行过**。
    //
    // 背景（台账「另案 ⑥」）：真实目录 3394 个 json，全量 `readFileSync`+`JSON.parse`
    // 首次 ≈1.1s（而每个 HTTP 请求都触发它）。GAI-3（2026-10-05）：检查点 / WorkItem 已迁入
    // `app.db`（SQLite）⇒ 启动时一次性**幂等迁移**历史 JSON（不删原文件、失败不阻断），
    // 迁移后再执行启动扫描（读 DB，不再逐文件解析）。整体不阻塞启动，失败也不影响主流程。
    void (async () => {
      try {
        const bridge = await import('./tasks/PdcaWorkItemBridge.js');
        // 1) 一次性幂等迁移：<pdca>/*.json → app.db（已存在则跳过）
        await bridge.migratePdcaCheckpointsFromJson();
        // 2) 启动扫描：把崩溃遗留的 started/running 标为 abort
        const { scanAndAbortStalePdcaTasks } =
          await import('./infrastructure/http/handlers/pdca-handlers.js');
        // C1（2026-09-30 D-103）：该扫描已改 `async`（端口 API 异步化）⇒ **必须 await**，
        // 以保持下方"留存清理在其之后"的既有次序约束（见紧邻注释）。
        await scanAndAbortStalePdcaTasks();
        // 3) 留存清理（仅"终态 + 超期 30 天"，非终态一律保留）
        //    ⚠️ **必须在启动扫描之后**：扫描刚给遗留任务刷新 `updatedAt` ⇒ 它们会因"新鲜"被保留，
        //    不会被"刚标完就删掉"。
        await bridge.prunePdcaCheckpoints();
      } catch {
        // @ignore-catch: 迁移/扫描/留存失败不影响主流程
      }
    })();

    // T2: 模式分发 + 后台延迟加载
    profileCheckpoint('T2_dispatch_start');
    profilePhaseStart('T2_dispatch');
    switch (options.mode) {
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

    // 启动完成汇总（阶段耗时 + 初始化失败 + 就绪标记 + profileReport）
    // 2026-09-29（台账「另案 ⑦」）：抽成 `reportBootCompletion()` 以便 DAEMON 复用
    //（DAEMON 下本尾部永不执行）。
    await reportBootCompletion(initFailures);
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
 * 默认启动函数（由 `pyapp.ts` 经 `await import('./main')` 调用）
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
