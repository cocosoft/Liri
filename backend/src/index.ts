#!/usr/bin/env bun
/**
 * PY_APP - 主入口文件
 */

// 安全设置：防止Windows从当前目录执行命令
// 这必须在任何命令执行之前设置，以防止PATH劫持攻击
process.env.NoDefaultCurrentDirectoryInExePath = '1';

// 导入性能分析工具
import { profileCheckpoint } from './utils/startupProfiler';
import { startMemoryMonitoring, startMemoryOptimization } from './performance/MemoryManager';
import { startMemoryOptimization as startAdvancedMemoryOptimization } from './performance/MemoryOptimizer';

// 导入优化的入口系统
import { init } from './entrypoints/init.js';
import { parseRunMode, normalizeArgs } from './utils/cliArgs.js';
import chalk from 'chalk';
import { getExtensibilityService } from './core/extensibility/index.js';
import { mcpSystem } from './services/mcp/index.js';

// 初始化应用
profileCheckpoint('main_init_start');
await init();
profileCheckpoint('main_init_end');

// 初始化MCP系统
profileCheckpoint('mcp_init_start');
try {
  await mcpSystem.initialize();
  console.log(chalk.green('MCP系统初始化成功'));
} catch (error) {
  console.error(chalk.red('MCP系统初始化失败:'), error);
}
profileCheckpoint('mcp_init_end');

// 启动内存监控和优化
profileCheckpoint('memory_monitoring_start');
try {
  startMemoryMonitoring();
  startAdvancedMemoryOptimization();
  console.log(chalk.green('内存监控和优化已启动'));
} catch (error) {
  console.error(chalk.red('内存监控和优化启动失败:'), error);
}
profileCheckpoint('memory_monitoring_end');

// 解析运行模式
profileCheckpoint('parse_run_mode_start');
const runMode = parseRunMode();
const normalizedArgs = normalizeArgs(process.argv.slice(2));
profileCheckpoint('parse_run_mode_end');

// 根据运行模式分发
if (runMode === 'mcp') {
  profileCheckpoint('mcp_mode_start');
  const { startMCPServer } = await import('./entrypoints/mcp.js');
  await startMCPServer(process.cwd(), false, false);
  profileCheckpoint('mcp_mode_end');
} else if (runMode === 'print') {
  // 单次执行模式
  profileCheckpoint('print_mode_start');
  const { executeOnce } = await import('./entrypoints/repl.js');
  const printArgs = normalizedArgs.filter(
    (arg) => arg !== '--print' && arg !== '-p'
  );
  if (printArgs.length > 0) {
    await executeOnce(printArgs[0], printArgs.slice(1).join(' '));
  } else {
    console.error(chalk.red('错误:'), '单次执行模式需要提供命令');
    process.exit(1);
  }
  profileCheckpoint('print_mode_end');
} else if (runMode === 'pipe') {
  // 管道模式
  profileCheckpoint('pipe_mode_start');
  const { executeFromPipe } = await import('./entrypoints/repl.js');
  await executeFromPipe();
  profileCheckpoint('pipe_mode_end');
} else if (runMode === 'background') {
  // 后台会话模式（简化实现）
  profileCheckpoint('background_mode_start');
  console.log(chalk.yellow('后台会话模式暂未实现'));
  process.exit(0);
  profileCheckpoint('background_mode_end');
} else {
  // 默认为REPL模式
  profileCheckpoint('repl_mode_start');
  const { launchRepl } = await import('./entrypoints/repl.js');
  await launchRepl();
  profileCheckpoint('repl_mode_end');
}

// 关闭插件系统和MCP系统
process.on('exit', async () => {
  try {
    profileCheckpoint('shutdown_start');
    
    // 关闭MCP系统
    await mcpSystem.cleanup();
    
    // 关闭插件系统
    const extensibilityService = getExtensibilityService();
    await extensibilityService.shutdown();
    
    profileCheckpoint('shutdown_end');
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
});
