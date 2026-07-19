/**
 * Debug 命令实现
 * 显示调试信息、系统状态和进程信息
 */
import {
  arch,
  platform,
  hostname,
  totalmem,
  freemem,
  cpus,
  uptime,
  loadavg,
} from 'os';
import type { CommandContext, CommandResult } from '@modules/commands';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'commands:builtin:debug:Debug',
  level: LogLevel.INFO,
});

/**
 * 解析标志参数
 */
function parseFlags(args: string): { showJson: boolean; subcommand: string } {
  const trimmed = args.trim();
  const showJson = /(^|\s)--json(\s|$)/.test(trimmed);
  const cleaned = trimmed.replace(/--json\s*/g, '').trim();
  const subcommand = cleaned || 'status';

  return { showJson, subcommand };
}

/**
 * 格式化字节为可读大小
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

/**
 * 格式化秒数为可读时间
 */
function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}天`);
  if (h > 0) parts.push(`${h}小时`);
  if (m > 0) parts.push(`${m}分`);
  parts.push(`${s}秒`);
  return parts.join('');
}

/**
 * 显示帮助信息
 */
function showHelp(): CommandResult {
  const help = `Debug 命令使用帮助

用法:
  /debug                    - 显示调试概览（默认）
  /debug status             - 显示系统状态
  /debug inspect            - 显示进程详细信息
  /debug --json             - 以 JSON 格式输出概览
  /debug status --json      - 以 JSON 格式输出系统状态
  /debug inspect --json     - 以 JSON 格式输出进程信息
  /debug help               - 显示此帮助

输出内容:
  系统状态 - 平台、CPU、内存、运行时间、负载
  进程信息 - PID、Node版本、内存详细、CPU使用、资源占用

示例:
  /debug
  /debug status
  /debug inspect
  /debug --json

别名: /dev, /developer`;

  return { success: true, message: help };
}

/**
 * 获取系统状态数据
 */
function getSystemData() {
  const memTotal = totalmem();
  const memFree = freemem();
  const cpuInfo = cpus();

  return {
    platform: platform(),
    arch: arch(),
    hostname: hostname(),
    uptime: uptime(),
    uptimeFormatted: formatUptime(uptime()),
    memory: {
      total: memTotal,
      free: memFree,
      used: memTotal - memFree,
      usagePercent: (((memTotal - memFree) / memTotal) * 100).toFixed(1),
      totalFormatted: formatBytes(memTotal),
      freeFormatted: formatBytes(memFree),
      usedFormatted: formatBytes(memTotal - memFree),
    },
    cpus: {
      count: cpuInfo.length,
      model: cpuInfo[0]?.model || 'unknown',
      speed: cpuInfo[0]?.speed ? `${cpuInfo[0].speed} MHz` : 'unknown',
    },
    loadAverage: loadavg(),
  };
}

/**
 * 获取进程信息数据
 */
function getProcessData() {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();

  return {
    pid: process.pid,
    ppid: process.ppid,
    title: process.title,
    nodeVersion: process.version,
    nodeVersions: process.versions,
    uptime: process.uptime(),
    uptimeFormatted: formatUptime(process.uptime()),
    cwd: process.cwd(),
    memoryUsage: {
      rss: memUsage.rss,
      heapTotal: memUsage.heapTotal,
      heapUsed: memUsage.heapUsed,
      external: memUsage.external,
      rssFormatted: formatBytes(memUsage.rss),
      heapTotalFormatted: formatBytes(memUsage.heapTotal),
      heapUsedFormatted: formatBytes(memUsage.heapUsed),
      externalFormatted: formatBytes(memUsage.external),
    },
    cpuUsage: {
      user: cpuUsage.user,
      system: cpuUsage.system,
    },
    argv: process.argv,
  };
}

/**
 * 格式化系统状态文本输出
 */
function formatStatusText(data: ReturnType<typeof getSystemData>): string {
  const lines: string[] = [];
  lines.push('系统状态\n');
  lines.push('═'.repeat(40));
  lines.push('');
  lines.push(`  平台: ${data.platform} ${data.arch}`);
  lines.push(`  主机: ${data.hostname}`);
  lines.push(`  运行时间: ${data.uptimeFormatted}`);
  lines.push(`  CPU: ${data.cpus.count}x ${data.cpus.model}`);
  lines.push(
    `  内存: ${data.memory.usedFormatted} / ${data.memory.totalFormatted} (${data.memory.usagePercent}%)`
  );
  lines.push(`  内存空闲: ${data.memory.freeFormatted}`);
  lines.push(`  负载: ${data.loadAverage.map((v) => v.toFixed(2)).join(', ')}`);

  return lines.join('\n');
}

/**
 * 格式化进程信息文本输出
 */
function formatInspectText(data: ReturnType<typeof getProcessData>): string {
  const lines: string[] = [];
  lines.push('进程信息\n');
  lines.push('═'.repeat(40));
  lines.push('');
  lines.push(`  PID: ${data.pid} (父进程: ${data.ppid})`);
  lines.push(`  Node.js: ${data.nodeVersion}`);
  lines.push(`  运行时间: ${data.uptimeFormatted}`);
  lines.push(`  工作目录: ${data.cwd}`);
  lines.push('');
  lines.push('  内存使用:');
  lines.push(`    RSS:        ${data.memoryUsage.rssFormatted}`);
  lines.push(`    堆总大小:   ${data.memoryUsage.heapTotalFormatted}`);
  lines.push(`    堆已用:     ${data.memoryUsage.heapUsedFormatted}`);
  lines.push(`    外部:       ${data.memoryUsage.externalFormatted}`);
  lines.push('');
  lines.push(
    `  CPU: 用户态 ${(data.cpuUsage.user / 1000).toFixed(1)}ms, 内核态 ${(data.cpuUsage.system / 1000).toFixed(1)}ms`
  );

  return lines.join('\n');
}

/**
 * 处理 status 子命令
 */
async function handleStatus(showJson: boolean): Promise<CommandResult> {
  const data = getSystemData();

  if (showJson) {
    return { success: true, message: JSON.stringify(data, null, 2) };
  }

  return { success: true, message: formatStatusText(data) };
}

/**
 * 处理 inspect 子命令
 */
async function handleInspect(showJson: boolean): Promise<CommandResult> {
  const data = getProcessData();

  if (showJson) {
    return { success: true, message: JSON.stringify(data, null, 2) };
  }

  return { success: true, message: formatInspectText(data) };
}

const debugCommand = {
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    try {
      const { showJson, subcommand } = parseFlags(args);

      if (
        subcommand === 'help' ||
        subcommand === '-h' ||
        subcommand === '--help'
      ) {
        return showHelp();
      }

      try {
        const { logEvent } = await import('@modules/analytics/index.js');
        logEvent('tengu_debug_view', { subcommand, showJson });
      } catch (err) {
        // analytics 非关键

        logger.debug('Operation skipped', {
          context: 'analytics 非关键',
          error: err instanceof Error ? err.message : String(err),
        });
      }

      switch (subcommand.toLowerCase()) {
        case 'status':
          return await handleStatus(showJson);
        case 'inspect':
          return await handleInspect(showJson);
        default:
          return showHelp();
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export default debugCommand;
