/**
 * 诊断处理器
 * 处理 diagnose 命令组，提供网络、健康、调试诊断功能
 */

import chalk from 'chalk';
import * as os from 'os';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { createConfigManager } from '@modules/cli/config';
import { createSessionGateway } from '@modules/session/SessionGateway';
import { SlowQueryDetector } from '@modules/query/SlowQueryDetector';

const logger = new Logger({ level: LogLevel.INFO });

export interface DiagnoseHandlerOptions {
  verbose?: boolean;
}

/** 诊断检测项结果 */
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
}

export class DiagnoseHandler {
  private options: DiagnoseHandlerOptions;

  constructor(options?: DiagnoseHandlerOptions) {
    this.options = { verbose: false, ...options };
  }

  /**
   * 主分发方法
   */
  async handle(command: string, args: string[]): Promise<boolean> {
    switch (command) {
      case 'network':
        await this.handleNetwork();
        return true;
      case 'health':
        await this.handleHealth();
        return true;
      case 'debug':
        await this.handleDebug(args);
        return true;
      case 'slow-query':
        await this.handleSlowQuery(args);
        return true;
      default:
        return false;
    }
  }

  /**
   * 网络诊断
   * diagnose network
   */
  async handleNetwork(): Promise<void> {
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold('  网络诊断'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log();

    const targets = [
      { name: 'GitHub API', url: 'https://api.github.com' },
      { name: 'Google API', url: 'https://www.googleapis.com' },
      { name: 'NPM Registry', url: 'https://registry.npmjs.org' },
    ];

    const results: CheckResult[] = [];

    for (const target of targets) {
      if (this.options.verbose) {
        logger.info('Ping endpoint', { name: target.name, url: target.url });
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const startTime = performance.now();
        const response = await fetch(target.url, {
          method: 'HEAD',
          signal: controller.signal,
        });
        const elapsed = Math.round(performance.now() - startTime);
        clearTimeout(timeout);

        results.push({
          name: target.name,
          status: response.ok ? 'ok' : 'warn',
          message: `${response.status} ${response.statusText} (${elapsed}ms)`,
        });
      } catch (error) {
        results.push({
          name: target.name,
          status: 'error',
          message: `连接失败: ${(error as Error).message}`,
        });
      }
    }

    printResults(results);

    if (this.options.verbose) {
      logger.info('网络诊断完成', {
        total: results.length,
        ok: results.filter((r) => r.status === 'ok').length,
        errors: results.filter((r) => r.status === 'error').length,
      });
    }
  }

  /**
   * 系统健康诊断
   * diagnose health
   */
  async handleHealth(): Promise<void> {
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold('  系统健康诊断'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log();

    const results: CheckResult[] = [];

    // CPU 负载
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    const cpuUsage = loadAvg[0] / cpus.length;
    results.push({
      name: 'CPU 负载',
      status: cpuUsage < 0.7 ? 'ok' : cpuUsage < 0.9 ? 'warn' : 'error',
      message: `${(cpuUsage * 100).toFixed(1)}% (${loadAvg[0].toFixed(2)})`,
    });

    // 内存使用
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsage = ((totalMem - freeMem) / totalMem) * 100;
    results.push({
      name: '内存使用',
      status: memUsage < 80 ? 'ok' : memUsage < 90 ? 'warn' : 'error',
      message: `${memUsage.toFixed(1)}% (${formatBytes(totalMem - freeMem)} / ${formatBytes(totalMem)})`,
    });

    // 系统运行时间
    const uptime = os.uptime();
    results.push({
      name: '系统运行时间',
      status: 'ok',
      message: formatUptime(uptime),
    });

    // Node.js 内存
    const processMem = process.memoryUsage();
    const heapUsage = (processMem.heapUsed / processMem.heapTotal) * 100;
    results.push({
      name: 'Node.js 堆内存',
      status: heapUsage < 80 ? 'ok' : heapUsage < 90 ? 'warn' : 'error',
      message: `${heapUsage.toFixed(1)}% (${formatBytes(processMem.heapUsed)} / ${formatBytes(processMem.heapTotal)})`,
    });

    // 环境变量检查
    const requiredEnvVars = ['NODE_ENV', 'PY_APP_HOME'];
    const missingEnvVars = requiredEnvVars.filter(
      (v) => !process.env[v] && v !== 'NODE_ENV'
    );
    results.push({
      name: '环境变量',
      status: missingEnvVars.length === 0 ? 'ok' : 'warn',
      message:
        missingEnvVars.length === 0
          ? '已配置'
          : `缺少: ${missingEnvVars.join(', ')}`,
    });

    printResults(results);

    if (this.options.verbose) {
      logger.info('健康诊断完成', {
        ok: results.filter((r) => r.status === 'ok').length,
        warnings: results.filter((r) => r.status === 'warn').length,
        errors: results.filter((r) => r.status === 'error').length,
      });
    }
  }

  /**
   * 调试信息
   * diagnose debug [scope]
   */
  async handleDebug(args: string[]): Promise<void> {
    const scope = args[0] || 'all';

    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold('  调试信息'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log();

    switch (scope) {
      case 'all':
        await this.printAllDebugInfo();
        break;
      case 'system':
        this.printSystemInfo();
        break;
      case 'config':
        await this.printConfigDebug();
        break;
      case 'session':
        await this.printSessionDebug();
        break;
      default:
        console.log(chalk.yellow('⚠'), `未知调试范围: ${scope}`);
        console.log(chalk.gray('  可用范围: all, system, config, session'));
    }

    console.log(chalk.cyan('═'.repeat(60)));
  }

  /**
   * 慢查询检测
   * diagnose slow-query [threshold]
   */
  async handleSlowQuery(args: string[]): Promise<void> {
    const thresholdArg = args[0];
    const thresholdMs = thresholdArg ? parseInt(thresholdArg, 10) : undefined;
    const detector = new SlowQueryDetector(thresholdMs);

    if (thresholdMs) {
      logger.info('使用自定义慢查询阈值', { thresholdMs });
    }

    await detector.printReport();
  }

  /**
   * 输出全部调试信息
   */
  private async printAllDebugInfo(): Promise<void> {
    this.printSystemInfo();
    console.log();
    await this.printConfigDebug();
    console.log();
    await this.printSessionDebug();
  }

  /**
   * 输出系统信息
   */
  private printSystemInfo(): void {
    console.log(chalk.bold('系统信息:'));
    console.log(
      `  ${chalk.gray('平台:')}     ${os.platform()} ${os.release()}`
    );
    console.log(`  ${chalk.gray('架构:')}     ${os.arch()}`);
    console.log(`  ${chalk.gray('主机名:')}   ${os.hostname()}`);
    console.log(`  ${chalk.gray('CPU:')}      ${os.cpus()[0]?.model || 'N/A'}`);
    console.log(`  ${chalk.gray('CPU核心:')}  ${os.cpus().length}`);
    console.log(`  ${chalk.gray('内存:')}     ${formatBytes(os.totalmem())}`);
    console.log(`  ${chalk.gray('运行时间:')} ${formatUptime(os.uptime())}`);
    console.log(`  ${chalk.gray('用户:')}     ${os.userInfo().username}`);
    console.log(`  ${chalk.gray('Node.js:')}  ${process.version}`);
    console.log(`  ${chalk.gray('PID:')}      ${process.pid}`);
  }

  /**
   * 输出配置调试信息
   */
  private async printConfigDebug(): Promise<void> {
    console.log(chalk.bold('配置状态:'));
    try {
      const configManager = createConfigManager();
      const config = configManager.getConfig();
      console.log(
        `  ${chalk.gray('路径:')}   ${configManager.getConfigPath()}`
      );
      console.log(
        `  ${chalk.gray('应用:')}   ${config.app.name} v${config.app.version}`
      );
      console.log(
        `  ${chalk.gray('CLI:')}    提示符="${config.cli.prompt}", 颜色=${config.cli.color}`
      );
      const validResult = configManager.validate();
      if (validResult.valid) {
        console.log(chalk.green('  ✓ 配置验证通过'));
      } else {
        console.log(chalk.red('  ✕ 配置验证失败'));
        validResult.errors?.forEach((e) =>
          console.log(chalk.gray(`     - ${e}`))
        );
      }
    } catch (error) {
      console.log(
        chalk.red('  ✕'),
        `读取配置失败: ${(error as Error).message}`
      );
    }
  }

  /**
   * 输出会话调试信息
   */
  private async printSessionDebug(): Promise<void> {
    console.log(chalk.bold('会话状态:'));
    try {
      const gateway = createSessionGateway();
      await gateway.initialize();
      const sessions = await gateway.listSessions();
      const stats = await gateway.getSessionStats();
      console.log(`  ${chalk.gray('总数:')}   ${stats.totalSessions}`);
      console.log(`  ${chalk.gray('活跃:')}   ${stats.activeSessions}`);
      console.log(`  ${chalk.gray('已归档:')} ${stats.archivedSessions}`);
      console.log(`  ${chalk.gray('消息数:')} ${stats.totalMessages}`);
    } catch (error) {
      console.log(
        chalk.yellow('  ⚠'),
        `读取会话状态失败: ${(error as Error).message}`
      );
    }
  }

  /**
   * 显示诊断帮助
   */
  showHelp(): void {
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold('  diagnose - 系统诊断'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log();
    console.log(chalk.green('用法:'));
    console.log(chalk.gray('  diagnose network             - 网络连通性检测'));
    console.log(chalk.gray('  diagnose health              - 系统健康检查'));
    console.log(chalk.gray('  diagnose debug [scope]       - 调试信息'));
    console.log(
      chalk.gray('  diagnose slow-query [threshold] - 慢查询检测报告')
    );
    console.log();
    console.log(chalk.green('调试范围:'));
    console.log(chalk.gray('  all      全部信息 (默认)'));
    console.log(chalk.gray('  system   系统信息'));
    console.log(chalk.gray('  config   配置信息'));
    console.log(chalk.gray('  session  会话信息'));
    console.log();
    console.log(chalk.green('慢查询参数:'));
    console.log(chalk.gray('  threshold   阈值（毫秒），默认 5000'));
    console.log();
    console.log(chalk.green('示例:'));
    console.log(chalk.gray('  diagnose network'));
    console.log(chalk.gray('  diagnose health'));
    console.log(chalk.gray('  diagnose debug system'));
    console.log(chalk.gray('  diagnose slow-query'));
    console.log(chalk.gray('  diagnose slow-query 10000'));
    console.log(chalk.cyan('═'.repeat(60)));
  }
}

/**
 * 打印诊断结果
 */
function printResults(results: CheckResult[]): void {
  for (const result of results) {
    const icon =
      result.status === 'ok'
        ? chalk.green('✓')
        : result.status === 'warn'
          ? chalk.yellow('⚠')
          : chalk.red('✕');

    console.log(`  ${icon} ${chalk.bold(result.name)}`);
    console.log(`    ${chalk.gray(result.message)}`);
  }

  const okCount = results.filter((r) => r.status === 'ok').length;
  console.log();
  console.log(chalk.gray(`  ${okCount}/${results.length} 项通过`));
}

/**
 * 格式化字节数
 */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * 格式化运行时间
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  parts.push(`${minutes}分钟`);

  return parts.join(' ');
}

/**
 * 创建诊断处理器
 */
export function createDiagnoseHandler(
  options?: DiagnoseHandlerOptions
): DiagnoseHandler {
  return new DiagnoseHandler(options);
}
