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

/**
 * 主CLI入口函数
 * 实现快速路径分发和多种运行模式支持
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const normalizedArgs = normalizeArgs(args);

  // 快速路径：版本检查
  const versionArgs = normalizedArgs.filter(
    (arg) => arg === '--version' || arg === '-v' || arg === '-V'
  );
  if (versionArgs.length === 1 && normalizedArgs.length <= 2) {
    console.log('1.0.0 (PY_APP)');
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
    console.log('  -v, --version     显示版本信息');
    console.log('  -h, --help        显示帮助信息');
    console.log('  -p, --print       单次执行模式');
    console.log('  --mcp             MCP服务器模式');
    console.log('  --bg, --background 后台会话模式');
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

  // 验证参数
  const validation = validateArgs(normalizedArgs);
  if (!validation.valid) {
    console.error(chalk.red('Error:'), validation.error);
    process.exit(1);
  }

  // 解析运行模式
  const runMode = parseRunMode(process.argv);

  // 根据运行模式分发
  if (runMode === 'mcp') {
    const { startMCPServer } = await import('./mcp.js');
    await startMCPServer(process.cwd(), false, false);
    return;
  } else if (runMode === 'print') {
    // 单次执行模式
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
    // 管道模式
    const { executeFromPipe } = await import('./repl.js');
    await executeFromPipe();
    return;
  } else if (runMode === 'background') {
    // 后台会话模式（简化实现）
    console.log(chalk.yellow('后台会话模式暂未实现'));
    process.exit(0);
    return;
  }

  // 默认为完整应用模式
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
