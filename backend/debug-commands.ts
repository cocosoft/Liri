// 调试脚本：定位 commands 模块中的问题
import chalk from 'chalk';

async function testCommandsImports() {
  console.log(chalk.blue('=== 开始测试 commands 模块的导入 ===\n'));
  
  const modules = [
    { name: 'types', path: './src/commands/types/index' },
    { name: 'registry', path: './src/commands/registry/index' },
    { name: 'executor', path: './src/commands/executor/index' },
    { name: 'pipeline', path: './src/commands/pipeline/index' },
    { name: 'loader/CommandLoader', path: './src/commands/loader/CommandLoader' },
    { name: 'manager/CommandManager', path: './src/commands/manager/CommandManager' },
    { name: 'history', path: './src/commands/history/index' },
    { name: 'builtin/help', path: './src/commands/builtin/help/index' },
    { name: 'builtin/status', path: './src/commands/builtin/status/index' },
    { name: 'builtin/clear', path: './src/commands/builtin/clear/index' },
    { name: 'builtin/exit', path: './src/commands/builtin/exit/index' },
    { name: 'builtin/version', path: './src/commands/builtin/version/index' },
    { name: 'builtin/session', path: './src/commands/builtin/session/index' },
    { name: 'builtin/config', path: './src/commands/builtin/config/index' },
  ];

  for (const module of modules) {
    try {
      console.log(chalk.yellow(`正在导入: ${module.name}`));
      await import(module.path);
      console.log(chalk.green(`✓ ${module.name} 导入成功\n`));
    } catch (error) {
      console.log(chalk.red(`✗ ${module.name} 导入失败:`));
      console.log(chalk.red(`  错误: ${error.message}\n`));
      process.exit(1);
    }
  }

  console.log(chalk.blue('=== 所有 commands 子模块导入成功 ==='));
}

testCommandsImports().catch(console.error);
