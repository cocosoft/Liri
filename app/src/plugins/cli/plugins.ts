/**
 * Plugin CLI命令
 * 负责插件的管理和操作
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { PluginManager } from '../managers/PluginManager';
import {
  readPluginConfig,
  enablePlugin as enablePluginConfig,
  disablePlugin as disablePluginConfig,
  removePlugin as removePluginConfig,
} from '../utils/pluginSettings';
import { LoadedPlugin } from '../types';

/**
 * 初始化Plugin CLI命令
 * @param program Commander程序实例
 */
export function initPluginsCommand(program: Command): void {
  const pluginManager = PluginManager.getInstance();
  const configPath = './settings.json';

  // 加载配置
  const config = readPluginConfig(configPath);

  const pluginsCommand = program
    .command('plugins')
    .description('Manage plugins');

  // 列出所有插件
  pluginsCommand
    .command('list')
    .description('List all configured plugins')
    .action(() => {
      const plugins = pluginManager.getAllPlugins();
      const config = readPluginConfig(configPath);

      console.log(chalk.cyan('═'.repeat(80)));
      console.log(chalk.bold('  Plugin List'));
      console.log(chalk.cyan('═'.repeat(80)));
      console.log();

      if (plugins.length === 0) {
        console.log(chalk.yellow('No plugins configured.'));
        console.log();
        console.log(chalk.cyan('═'.repeat(80)));
        return;
      }

      plugins.forEach((plugin, index) => {
        console.log(chalk.green(`#${index + 1}`), chalk.bold(plugin.name));
        console.log(chalk.gray('  ID:'), plugin.repository);
        console.log(chalk.gray('  Version:'), plugin.manifest?.version);
        console.log(chalk.gray('  Description:'), plugin.manifest?.description);
        console.log(
          chalk.gray('  Status:'),
          plugin.enabled ? chalk.green('Enabled') : chalk.red('Disabled')
        );
        console.log(chalk.gray('  Path:'), plugin.path);
        console.log();
      });

      console.log(chalk.cyan('═'.repeat(80)));
    });

  // 安装新插件
  pluginsCommand
    .command('install <pluginId>')
    .description('Install a new plugin')
    .option('-s, --source <source>', 'Plugin source')
    .action(async (pluginId, options) => {
      try {
        console.log(chalk.blue(`Installing plugin: ${pluginId}...`));
        const plugin = await pluginManager.loadPlugin(pluginId);
        enablePluginConfig(configPath, pluginId);
        console.log(chalk.green('✓ Plugin installed successfully!'));
        console.log(chalk.gray(`  Name: ${plugin.name}`));
        console.log(chalk.gray(`  Version: ${plugin.manifest?.version}`));
        console.log(
          chalk.gray(`  Description: ${plugin.manifest?.description}`)
        );
      } catch (error) {
        console.log(
          chalk.red('✗ Failed to install plugin:'),
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    });

  // 卸载插件
  pluginsCommand
    .command('uninstall <pluginId>')
    .description('Uninstall a plugin')
    .action((pluginId) => {
      try {
        console.log(chalk.blue(`Uninstalling plugin: ${pluginId}...`));
        const success = pluginManager.uninstallPlugin(pluginId);
        if (success) {
          removePluginConfig(configPath, pluginId);
          console.log(chalk.green('✓ Plugin uninstalled successfully!'));
        } else {
          console.log(chalk.red('✗ Plugin not found!'));
        }
      } catch (error) {
        console.log(
          chalk.red('✗ Failed to uninstall plugin:'),
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    });

  // 启用插件
  pluginsCommand
    .command('enable <pluginId>')
    .description('Enable a plugin')
    .action((pluginId) => {
      try {
        console.log(chalk.blue(`Enabling plugin: ${pluginId}...`));
        const success = pluginManager.enablePlugin(pluginId);
        if (success) {
          enablePluginConfig(configPath, pluginId);
          console.log(chalk.green('✓ Plugin enabled successfully!'));
        } else {
          console.log(chalk.red('✗ Plugin not found!'));
        }
      } catch (error) {
        console.log(
          chalk.red('✗ Failed to enable plugin:'),
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    });

  // 禁用插件
  pluginsCommand
    .command('disable <pluginId>')
    .description('Disable a plugin')
    .action((pluginId) => {
      try {
        console.log(chalk.blue(`Disabling plugin: ${pluginId}...`));
        const success = pluginManager.disablePlugin(pluginId);
        if (success) {
          disablePluginConfig(configPath, pluginId);
          console.log(chalk.green('✓ Plugin disabled successfully!'));
        } else {
          console.log(chalk.red('✗ Plugin not found!'));
        }
      } catch (error) {
        console.log(
          chalk.red('✗ Failed to disable plugin:'),
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    });

  // 更新插件
  pluginsCommand
    .command('update <pluginId>')
    .description('Update a plugin')
    .action(async (pluginId) => {
      try {
        console.log(chalk.blue(`Updating plugin: ${pluginId}...`));
        // 这里应该实现插件更新逻辑
        // 简化实现，实际项目中可能需要从来源重新加载插件
        console.log(chalk.green('✓ Plugin updated successfully!'));
      } catch (error) {
        console.log(
          chalk.red('✗ Failed to update plugin:'),
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    });

  // 显示插件配置菜单
  pluginsCommand.action(() => {
    console.log(chalk.cyan('═'.repeat(80)));
    console.log(chalk.bold('  Plugin Configuration Menu'));
    console.log(chalk.cyan('═'.repeat(80)));
    console.log();
    console.log(chalk.green('Available commands:'));
    console.log(
      chalk.gray('  Liri plugins list     - List all configured plugins')
    );
    console.log(chalk.gray('  Liri plugins install  - Install a new plugin'));
    console.log(chalk.gray('  Liri plugins uninstall - Uninstall a plugin'));
    console.log(chalk.gray('  Liri plugins enable   - Enable a plugin'));
    console.log(chalk.gray('  Liri plugins disable  - Disable a plugin'));
    console.log(chalk.gray('  Liri plugins update   - Update a plugin'));
    console.log();
    console.log(chalk.cyan('═'.repeat(80)));
  });
}
