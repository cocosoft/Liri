// 调试脚本：定位 init 模块中的问题
import chalk from 'chalk';

async function testInitImports() {
  console.log(chalk.blue('=== 开始测试 init 模块的导入 ===\n'));
  
  const modules = [
    { name: 'config', path: './src/utils/config' },
    { name: 'commands', path: './src/commands/index' },
    { name: 'extensibility', path: './src/core/extensibility/index' },
    { name: 'startupProfiler', path: './src/utils/startupProfiler' },
    { name: 'gracefulShutdown', path: './src/utils/gracefulShutdown' },
    { name: 'monitoring', path: './src/monitoring/index' },
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

  console.log(chalk.blue('=== 所有 init 依赖模块导入成功 ==='));
}

testInitImports().catch(console.error);
