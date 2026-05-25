/**
 * 主CLI入口点
 * 负责应用的命令行接口和多种运行模式的分发
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { init } from './init.js';
import { createMcpCommand } from '../mcp/cli/mcpCommand.js';
import {
  eagerParseCliFlag,
  extractArgsAfterDoubleDash,
  parseRunMode,
  validateArgs,
  normalizeArgs,
} from '../utils/cliArgs.js';
import { generateBanner, getVersionString } from '../cli/banner/index.js';

/**
 * 启动前环境变量优化
 * 对标 CC 源码 entrypoints/cli.tsx 的启动前 process.env 设置
 */
function optimizeStartupEnv(): void {
  if (!process.env.PY_APP_PROFILE_STARTUP) {
    process.env.PY_APP_PROFILE_STARTUP = '0';
  }
  if (!process.env.FORCE_COLOR) {
    process.env.FORCE_COLOR = '1';
  }
  if (!process.env.COLORTERM) {
    process.env.COLORTERM = 'truecolor';
  }
  if (!process.env.PYTHONUNBUFFERED) {
    process.env.PYTHONUNBUFFERED = '1';
  }
  if (!process.env.NODE_OPTIONS) {
    process.env.NODE_OPTIONS = '--max-old-space-size=4096';
  }
}

/**
 * 输出系统提示
 */
async function dumpSystemPrompt(): Promise<void> {
  const contextModule: Record<string, unknown> =
    // @ts-expect-error - context.js 没有类型声明文件
    await import('../context/context.js');
  const getSystemContext = contextModule.getSystemContext as () => Promise<
    Record<string, unknown>
  >;
  if (typeof getSystemContext !== 'function') {
    console.log('{}');
    return;
  }
  const context = await getSystemContext();
  console.log(JSON.stringify(context, null, 2));
}

/**
 * 运行诊断检查
 */
async function runDoctor(): Promise<void> {
  console.log(chalk.cyan('PY_APP 系统诊断'));
  console.log(chalk.gray('='.repeat(40)));
  console.log(chalk.green('✓') + '  CLI 入口正常');
  console.log(chalk.green('✓') + `  Node.js ${process.version}`);
  console.log(chalk.green('✓') + `  平台: ${process.platform} ${process.arch}`);
  console.log(chalk.green('✓') + `  CWD: ${process.cwd()}`);
  console.log(chalk.green('✓') + `  PID: ${process.pid}`);
  if (process.env.DEEPSEEK_API_KEY) {
    console.log(chalk.green('✓') + '  DEEPSEEK_API_KEY 已配置');
  } else {
    console.log(chalk.yellow('⚠') + '  DEEPSEEK_API_KEY 未配置');
  }
}

/**
 * 检查是否为 MCP 快速路径
 * 对标 OpenClaw isGatewayRunFastPathArgv()
 */
export function isFastPathArgv(argv: string[]): boolean {
  const flags = new Set(argv.map((a) => a.toLowerCase()));
  return (
    (flags.has('--mcp') && argv.length <= 2) ||
    flags.has('--version') ||
    flags.has('-v') ||
    flags.has('-V') ||
    flags.has('--help') ||
    flags.has('-h') ||
    flags.has('--doctor') ||
    flags.has('--dump-system-prompt') ||
    flags.has('--list-modes') ||
    flags.has('--daemon') ||
    flags.has('--background') ||
    flags.has('--bg')
  );
}

/**
 * 显示启动 Banner
 * 对标 OpenClaw emitCliBanner()
 */
function emitBanner(): void {
  console.log();
  console.log(generateBanner({ description: 'AI Agent — TypeScript + Rust' }));
  console.log(chalk.gray(getVersionString()));
  console.log(chalk.gray('='.repeat(50)));
  console.log();
}

/**
 * 主CLI入口函数
 * 实现快速路径分发和多种运行模式支持
 */
export async function main(): Promise<void> {
  optimizeStartupEnv();

  const args = process.argv.slice(2);
  const normalizedArgs = normalizeArgs(args);

  // 快速路径：版本检查
  const versionArgs = normalizedArgs.filter(
    (arg) => arg === '--version' || arg === '-v' || arg === '-V'
  );
  if (versionArgs.length === 1 && normalizedArgs.length <= 2) {
    console.log(getVersionString());
    return;
  }

  // 快速路径：帮助信息
  const helpArgs = normalizedArgs.filter(
    (arg) => arg === '--help' || arg === '-h'
  );
  if (helpArgs.length === 1 && normalizedArgs.length <= 2) {
    console.log(chalk.cyan('PY_APP - AI Agent'));
    console.log(chalk.gray('Version: 1.0.0'));
    console.log();
    console.log('Usage: PY_APP [options] [command]');
    console.log();
    console.log('Options:');
    console.log('  -v, --version             显示版本信息');
    console.log('  -h, --help                显示帮助信息');
    console.log('  -p, --print               单次执行模式');
    console.log('  --mcp                     MCP服务器模式');
    console.log('  --daemon                  守护进程模式');
    console.log('  --bg, --background        后台会话模式');
    console.log('  --dump-system-prompt      输出系统提示并退出');
    console.log('  --doctor                  运行系统诊断');
    console.log('  --list-modes              列出可用运行模式');
    console.log();
    console.log('Commands:');
    console.log('  hello             显示欢迎信息');
    console.log('  status            显示项目状态');
    console.log('  mcp               管理MCP服务器和工具');
    console.log('  bridge            管理Bridge连接');
    console.log('  chronos           管理定时任务');
    console.log('  skills            管理技能');
    console.log('  hooks             管理Hook');
    console.log('  plugins           管理插件');
    return;
  }

  // 快速路径：输出系统提示
  if (normalizedArgs.includes('--dump-system-prompt')) {
    await dumpSystemPrompt();
    return;
  }

  // 快速路径：运行诊断
  if (normalizedArgs.includes('--doctor')) {
    await runDoctor();
    return;
  }

  // 快速路径：列出可用运行模式
  if (normalizedArgs.includes('--list-modes')) {
    console.log(chalk.cyan('PY_APP 可用运行模式'));
    console.log(chalk.gray('='.repeat(40)));
    console.log('  --mcp              MCP 服务器模式');
    console.log('  --daemon           守护进程模式');
    console.log('  --print, -p        单次执行模式');
    console.log('  --pipe             管道模式');
    console.log('  --background, --bg 后台会话模式');
    return;
  }

  // 快速路径：MCP 服务器模式
  if (normalizedArgs.includes('--mcp')) {
    const { startMCPServer } = await import('./mcp.js');
    await startMCPServer(process.cwd(), false, false);
    return;
  }

  // 快速路径：守护进程模式
  if (normalizedArgs.includes('--daemon')) {
    emitBanner();
    const { launch, LaunchMode } = await import('../main.js');
    await launch({ mode: LaunchMode.DAEMON });
    return;
  }

  // 快速路径：后台会话模式
  if (
    normalizedArgs.includes('--background') ||
    normalizedArgs.includes('--bg')
  ) {
    emitBanner();
    const { launch, LaunchMode } = await import('../main.js');
    await launch({ mode: LaunchMode.DAEMON });
    return;
  }

  // 验证参数
  const validation = validateArgs(normalizedArgs);
  if (!validation.valid) {
    console.error(chalk.red('Error:'), validation.error);
    process.exit(1);
  }

  // 解析运行模式（剩余模式：print, pipe）
  const runMode = parseRunMode(process.argv);

  if (runMode === 'print') {
    const { executeOnce } = await import('./repl.js');
    const printArgs = normalizedArgs.filter(
      (arg) => arg !== '--print' && arg !== '-p'
    );
    if (printArgs.length > 0) {
      await executeOnce(printArgs[0], printArgs.slice(1).join(' '));
    } else {
      console.error(chalk.red('错误:'), '单次执行模式需要提供命令');
      process.exit(1);
    }
    return;
  } else if (runMode === 'pipe') {
    const { executeFromPipe } = await import('./repl.js');
    await executeFromPipe();
    return;
  }

  // 默认为完整应用模式
  emitBanner();
  const { main } = await import('../main.js');
  await main();
}

/**
 * 启动CLI
 */
export async function startCli(): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error(
      chalk.red('Error:'),
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

export default { main, startCli };
