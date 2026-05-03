// 调试脚本：逐步导入模块来定位问题
import chalk from 'chalk';

async function testImports() {
  console.log(chalk.blue('=== 开始逐步导入测试 ===\n'));
  
  const modules = [
    { name: 'startupProfiler', path: './src/utils/startupProfiler' },
    { name: 'MemoryManager', path: './src/performance/MemoryManager' },
    { name: 'MemoryOptimizer', path: './src/performance/MemoryOptimizer' },
    { name: 'init', path: './src/entrypoints/init' },
    { name: 'cliArgs', path: './src/utils/cliArgs' },
    { name: 'extensibility', path: './src/core/extensibility/index' },
    { name: 'mcp', path: './src/services/mcp/index' },
    { name: 'commands', path: './src/commands/index' },
    { name: 'tools', path: './src/tools/index' },
    { name: 'chat', path: './src/chat/index' },
    { name: 'ui', path: './src/ui/index' },
    { name: 'plugins', path: './src/plugins/index' },
    { name: 'tasks', path: './src/tasks/index' },
    { name: 'ink', path: './src/ink/ink/index' },
    { name: 'components/ink', path: './src/components/ink' },
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

  console.log(chalk.blue('=== 所有模块导入成功 ==='));
}

testImports().catch(console.error);
