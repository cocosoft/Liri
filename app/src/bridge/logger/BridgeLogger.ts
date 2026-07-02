import chalk from 'chalk';
import { Logger, LogLevel } from '@modules/monitoring';
import type {
  BridgeConfig,
  BridgeLogger,
  SessionActivity,
  SpawnMode,
} from '../types/index';

const logger = new Logger({
  module: 'bridge:logger:bridgeLogger',
  level: LogLevel.INFO,
});

const STATE_LABELS: Record<string, string> = {
  idle: '待命',
  attached: '已连接',
  titled: '已标识',
  reconnecting: '重连中',
  failed: '故障',
};

function timestamp(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function truncateToWidth(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  return text.slice(0, maxWidth - 3) + '...';
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分${seconds % 60}秒`;
  const hours = Math.floor(minutes / 60);
  return `${hours}时${minutes % 60}分`;
}

/**
 * 创建 Bridge 日志器实例
 * 实现 BridgeLogger 接口，提供终端 UI 输出和日志记录
 */
export function createBridgeLogger(
  options: { verbose?: boolean; write?: (s: string) => void } = {}
): BridgeLogger {
  const verbose = options.verbose ?? false;
  const write = options.write ?? ((s: string) => process.stdout.write(s));

  let currentState: string = 'idle';
  let currentStateText = 'Ready';
  let repoName = '';
  let branch = '';
  let debugLogPath = '';
  let connectUrl = '';
  let cachedIngressUrl = '';
  let cachedEnvironmentId = '';
  let activeSessionUrl: string | null = null;
  let lastToolSummary: string | null = null;
  let lastToolTime = 0;
  let sessionActive = 0;
  let sessionMax = 1;
  let spawnMode: SpawnMode = 'single-session';
  let statusLineCount = 0;

  const TOOL_DISPLAY_EXPIRY_MS = 30_000;

  function countVisualLines(text: string): number {
    const cols = process.stdout.columns || 80;
    let count = 0;
    for (const logical of text.split('\n')) {
      if (logical.length === 0) {
        count++;
        continue;
      }
      count += Math.max(1, Math.ceil(logical.length / cols));
    }
    if (text.endsWith('\n')) count--;
    return count;
  }

  function writeStatus(text: string): void {
    write(text);
    statusLineCount += countVisualLines(text);
  }

  function clearStatusLines(): void {
    if (statusLineCount <= 0) return;
    write(`\x1b[${statusLineCount}A`);
    write('\x1b[J');
    statusLineCount = 0;
  }

  function printLog(line: string): void {
    clearStatusLines();
    write(line);
  }

  function renderStatusLine(): void {
    if (currentState === 'reconnecting' || currentState === 'failed') return;

    clearStatusLines();

    const indicator = '●';
    const isIdle = currentState === 'idle';
    const indicatorColor = isIdle ? chalk.green : chalk.cyan;
    const stateText = isIdle
      ? chalk.green(currentStateText)
      : chalk.cyan(currentStateText);

    let suffix = '';
    if (repoName) suffix += chalk.dim(' · ') + chalk.dim(repoName);
    if (branch && spawnMode !== 'worktree')
      suffix += chalk.dim(' · ') + chalk.dim(branch);

    if (debugLogPath) {
      writeStatus(`${chalk.yellow('[Logs]')} ${chalk.dim(debugLogPath)}\n`);
    }
    writeStatus(`${indicatorColor(indicator)} ${stateText}${suffix}\n`);

    if (sessionMax > 1) {
      const modeHint =
        spawnMode === 'worktree'
          ? '新会话将在隔离的工作树中创建'
          : '新会话将在当前目录中创建';
      writeStatus(
        `    ${chalk.dim(`容量: ${sessionActive}/${sessionMax} · ${modeHint}`)}\n`
      );
    }

    if (sessionMax === 1) {
      const modeText =
        spawnMode === 'single-session'
          ? '单会话模式 · 完成后退出'
          : spawnMode === 'worktree'
            ? `容量: ${sessionActive}/1 · 新会话将在隔离的工作树中创建`
            : `容量: ${sessionActive}/1 · 新会话将在当前目录中创建`;
      writeStatus(`    ${chalk.dim(modeText)}\n`);
    }

    if (
      sessionMax === 1 &&
      !isIdle &&
      lastToolSummary &&
      Date.now() - lastToolTime < TOOL_DISPLAY_EXPIRY_MS
    ) {
      writeStatus(`  ${chalk.dim(truncateToWidth(lastToolSummary, 60))}\n`);
    }

    const url = activeSessionUrl ?? connectUrl;
    if (url) {
      writeStatus('\n');
      const footerText = isIdle
        ? `随时随地使用 Liri 编码: ${url}`
        : `在 Liri 中继续编码: ${url}`;
      writeStatus(`${chalk.dim(footerText)}\n`);
    }
  }

  return {
    printBanner(config: BridgeConfig, environmentId: string): void {
      cachedIngressUrl = config.sessionIngressUrl;
      cachedEnvironmentId = environmentId;
      connectUrl = `${config.sessionIngressUrl}/code?bridge=${environmentId}`;

      if (verbose) {
        write(chalk.dim('远程控制') + '\n');
        if (config.spawnMode !== 'single-session') {
          write(chalk.dim('生成模式: ') + `${config.spawnMode}\n`);
          write(chalk.dim('最大并发会话数: ') + `${config.maxSessions}\n`);
        }
        write(chalk.dim('环境 ID: ') + `${environmentId}\n`);
      }
      write('\n');

      logger.info('Bridge 已启动', { environmentId, mode: config.spawnMode });
    },

    setAttached(sessionId: string): void {
      currentState = 'attached';
      currentStateText = '已连接';
      lastToolSummary = null;
      lastToolTime = 0;
      if (sessionMax <= 1) {
        activeSessionUrl = `${cachedIngressUrl}/session/${sessionId}?bridge=${cachedEnvironmentId}`;
      }
      renderStatusLine();
      logger.info('Bridge 会话已附加', { sessionId });
    },

    updateSessionCount(count: number, max: number, mode: SpawnMode): void {
      if (sessionActive === count && sessionMax === max && spawnMode === mode)
        return;
      sessionActive = count;
      sessionMax = max;
      spawnMode = mode;
    },

    updateSessionActivity(sessionId: string, activity: SessionActivity): void {
      logger.debug('会话活动更新', { sessionId, activity });
    },

    updateSessionStatus(
      _sessionId: string,
      _elapsed: string,
      activity: SessionActivity,
      _trail: string[]
    ): void {
      if (activity.type === 'tool_start') {
        lastToolSummary = activity.summary;
        lastToolTime = Date.now();
      }
      renderStatusLine();
    },

    updateIdleStatus(): void {
      currentState = 'idle';
      currentStateText = '待命';
      lastToolSummary = null;
      lastToolTime = 0;
      activeSessionUrl = null;
      renderStatusLine();
      logger.info('Bridge 回到空闲状态');
    },

    removeSession(sessionId: string): void {
      logger.debug('会话已移除', { sessionId });
    },

    clearStatus(): void {
      clearStatusLines();
    },

    refreshDisplay(): void {
      renderStatusLine();
    },

    logSessionComplete(sessionId: string, durationMs: number): void {
      printLog(
        chalk.dim(`[${timestamp()}]`) +
          ` 会话 ${chalk.green('已完成')} (${formatDuration(durationMs)}) ${chalk.dim(sessionId)}\n`
      );
      logger.info('Bridge 会话完成', { sessionId, durationMs });
    },

    logSessionFailed(sessionId: string, errorMessage: string): void {
      printLog(
        chalk.dim(`[${timestamp()}]`) +
          ` 会话 ${chalk.red('失败')}: ${errorMessage} ${chalk.dim(sessionId)}\n`
      );
      logger.error('Bridge 会话失败', { sessionId, error: errorMessage });
    },

    logReconnected(disconnectedMs: number): void {
      printLog(
        chalk.dim(`[${timestamp()}]`) +
          ` ${chalk.green('已重新连接')} (断开 ${formatDuration(disconnectedMs)})\n`
      );
      logger.info('Bridge 已重新连接', { disconnectedMs });
    },

    logError(message: string): void {
      printLog(chalk.red(`[${timestamp()}] 错误: ${message}`) + '\n');
      logger.error('Bridge 错误', { message });
    },

    logVerbose(message: string): void {
      if (verbose) {
        printLog(chalk.dim(`[${timestamp()}] ${message}`) + '\n');
      }
      logger.debug(message);
    },

    setDebugLogPath(path: string): void {
      debugLogPath = path;
    },
  };
}
