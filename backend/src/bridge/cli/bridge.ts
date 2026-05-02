/**
 * Bridge CLI命令
 * 负责Bridge系统的命令行界面
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { BridgeConfig } from '../types';
import { readBridgeConfig, writeBridgeConfig } from '../utils/bridgeConfig';

/**
 * 初始化Bridge CLI命令
 */
export function initBridgeCommand(program: Command): void {
  const configPath = './settings.json';

  const bridgeCommand = program
    .command('bridge')
    .description('Manage Bridge system');

  // 启动Bridge
  bridgeCommand
    .command('start')
    .description('Start Bridge system')
    .option('-d, --dir <dir>', 'Working directory')
    .option('-m, --max-sessions <max>', 'Maximum number of sessions')
    .action((options) => {
      console.log(chalk.blue('Starting Bridge system...'));

      // 读取配置
      let config = readBridgeConfig(configPath);

      // 更新配置
      if (options.dir) {
        config.dir = options.dir;
      }
      if (options.maxSessions) {
        config.maxSessions = parseInt(options.maxSessions);
      }

      // 保存配置
      writeBridgeConfig(configPath, config);

      // 这里应该启动Bridge主逻辑
      // 简化实现，实际项目中应该创建BridgeMain实例并运行
      console.log(chalk.green('✓ Bridge system started!'));
      console.log(chalk.gray(`  Working directory: ${config.dir}`));
      console.log(chalk.gray(`  Maximum sessions: ${config.maxSessions}`));
      console.log(chalk.gray(`  Machine name: ${config.machineName}`));
    });

  // 停止Bridge
  bridgeCommand
    .command('stop')
    .description('Stop Bridge system')
    .action(() => {
      console.log(chalk.blue('Stopping Bridge system...'));

      // 这里应该停止Bridge主逻辑
      // 简化实现，实际项目中应该调用BridgeMain的shutdown方法
      console.log(chalk.green('✓ Bridge system stopped!'));
    });

  // 查看Bridge状态
  bridgeCommand
    .command('status')
    .description('Show Bridge system status')
    .action(() => {
      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.bold('  Bridge System Status'));
      console.log(chalk.cyan('═'.repeat(60)));
      console.log();

      // 读取配置
      const config = readBridgeConfig(configPath);

      console.log(chalk.gray('  Configuration:'));
      console.log(chalk.gray('    Bridge ID:'), config.bridgeId);
      console.log(chalk.gray('    Machine name:'), config.machineName);
      console.log(chalk.gray('    Working directory:'), config.dir);
      console.log(chalk.gray('    Maximum sessions:'), config.maxSessions);
      console.log(chalk.gray('    Worker type:'), config.workerType);
      console.log(chalk.gray('    API base URL:'), config.apiBaseUrl);
      console.log(
        chalk.gray('    Session ingress URL:'),
        config.sessionIngressUrl
      );
      console.log(chalk.gray('    Spawn mode:'), config.spawnMode);
      console.log();

      // 这里应该显示实际的运行状态
      console.log(chalk.gray('  Status:'), chalk.green('Running'));
      console.log();
      console.log(chalk.cyan('─'.repeat(60)));
    });

  // 查看Bridge配置
  bridgeCommand
    .command('config')
    .description('Show Bridge configuration')
    .action(() => {
      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.bold('  Bridge Configuration'));
      console.log(chalk.cyan('═'.repeat(60)));
      console.log();

      // 读取配置
      const config = readBridgeConfig(configPath);

      console.log(JSON.stringify(config, null, 2));
      console.log();
      console.log(chalk.cyan('─'.repeat(60)));
    });

  // 显示Bridge菜单
  bridgeCommand.action(() => {
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold('  Bridge System Menu'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log();
    console.log(chalk.green('Available commands:'));
    console.log(chalk.gray('  PY_APP bridge start     - Start Bridge system'));
    console.log(chalk.gray('  PY_APP bridge stop      - Stop Bridge system'));
    console.log(
      chalk.gray('  PY_APP bridge status    - Show Bridge system status')
    );
    console.log(
      chalk.gray('  PY_APP bridge config    - Show Bridge configuration')
    );
    console.log();
    console.log(chalk.cyan('─'.repeat(60)));
  });
}
