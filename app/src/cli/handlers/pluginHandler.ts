/**
 * 插件处理器
 * 处理CLI中的插件相关命令
 */

import chalk from 'chalk';
import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { ErrorCodes } from '@modules/error';
import { resolve } from 'path';
import { writePluginTemplate } from '@modules/plugin-sdk';
import type { PluginScaffoldOptions } from '@modules/plugin-sdk';

const logger = getLogger('pluginHandler');

export interface PluginHandlerOptions {
  verbose?: boolean;
}

export interface PluginInfo {
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  author?: string;
}

export class PluginHandler {
  private options: PluginHandlerOptions;
  private plugins: PluginInfo[] = [];

  constructor(options?: PluginHandlerOptions) {
    this.options = { verbose: false, ...options };
  }

  /**
   * 处理创建（脚手架）命令 —— 4.5 脚手架 CLI
   * 生成插件项目模板：package.json（pyapp 字段，含 inject 声明）+ index.js + README
   * @param args [目标目录] [插件名]（可选 --id/--author 等见 options）
   * @param options 脚手架选项（id/author/category/inject/injectOptional 等）
   */
  async handleCreate(
    args: string[],
    options: Record<string, unknown> = {}
  ): Promise<void> {
    const targetDir = args[0];
    const pluginName = args[1] || 'my-plugin';

    if (!targetDir) {
      throw AppError.fromCode(ErrorCodes.INVALID_INPUT, {
        category: ErrorCategory.VALIDATION,
        context: { handler: 'PluginHandler', operation: 'handleCreate' },
      });
    }

    const scaffoldOptions: PluginScaffoldOptions = {
      id: String(options.id ?? pluginName),
      name: String(options.name ?? pluginName),
      version: String(options.version ?? '0.1.0'),
      description: String(options.description ?? ''),
      author: String(options.author ?? ''),
      category: String(options.category ?? 'tool'),
      inject: (options.inject as string[] | undefined) ?? [
        'kernel.configManager',
      ],
      injectOptional: (options.injectOptional as string[] | undefined) ?? [
        'kernel.eventSystem',
      ],
    };

    try {
      const dir = resolve(targetDir);
      const files = writePluginTemplate(dir, scaffoldOptions);

      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.bold('  Plugin scaffold created'));
      console.log(chalk.cyan('═'.repeat(60)));
      for (const file of files) {
        console.log(chalk.green('✓'), resolve(dir, file));
      }
      console.log();
      console.log(
        chalk.gray(
          '  下一步: 编辑 index.js 实现逻辑，运行插件系统即可自动加载。'
        )
      );
      console.log(chalk.cyan('═'.repeat(60)));
    } catch (error) {
      throw AppError.fromCode(ErrorCodes.EXECUTION_FAILED, {
        category: ErrorCategory.EXECUTION,
        cause: error instanceof Error ? error : undefined,
        context: { handler: 'PluginHandler', operation: 'handleCreate' },
      });
    }
  }

  /**
   * 处理列表命令
   */
  async handleList(): Promise<void> {
    if (this.options.verbose) {
      logger.info('Loading plugins...');
    }

    try {
      await this.loadPlugins();

      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.bold('  Plugins'));
      console.log(chalk.cyan('═'.repeat(60)));
      console.log();

      if (this.plugins.length === 0) {
        console.log(chalk.yellow('⚠'), 'No plugins installed');
      } else {
        this.plugins.forEach((plugin, index) => {
          const enabledIcon = plugin.enabled
            ? chalk.green('✓')
            : chalk.red('✗');
          console.log(
            chalk.green(`${String(index + 1).padStart(2)}.`),
            plugin.name
          );
          console.log(`   ${chalk.gray('Version:')} ${plugin.version}`);
          console.log(`   ${chalk.gray('Description:')} ${plugin.description}`);
          console.log(
            `   ${chalk.gray('Enabled:')} ${enabledIcon} ${plugin.enabled ? 'Yes' : 'No'}`
          );
          if (plugin.author) {
            console.log(`   ${chalk.gray('Author:')} ${plugin.author}`);
          }
          console.log();
        });
      }

      console.log(chalk.cyan('═'.repeat(60)));
    } catch (error) {
      throw AppError.fromCode(ErrorCodes.EXECUTION_FAILED, {
        category: ErrorCategory.EXECUTION,
        cause: error instanceof Error ? error : undefined,
        context: { handler: 'PluginHandler', operation: 'handleList' },
      });
    }
  }

  /**
   * 处理启用命令
   */
  async handleEnable(args: string[]): Promise<void> {
    const pluginName = args[0];

    if (!pluginName) {
      throw AppError.fromCode(ErrorCodes.INVALID_INPUT, {
        category: ErrorCategory.VALIDATION,
        context: { handler: 'PluginHandler', operation: 'handleEnable' },
      });
    }

    if (this.options.verbose) {
      logger.info(`Enabling plugin: ${pluginName}`);
    }

    try {
      const plugin = this.plugins.find((p) => p.name === pluginName);
      if (!plugin) {
        throw new AppError(
          `Plugin not found: ${pluginName}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1005'
        );
      }

      plugin.enabled = true;
      await this.savePluginState(plugin);

      console.log(chalk.green('✓'), `Plugin ${pluginName} enabled`);
    } catch (error) {
      throw AppError.fromCode(ErrorCodes.EXECUTION_FAILED, {
        category: ErrorCategory.EXECUTION,
        cause: error instanceof Error ? error : undefined,
        context: {
          handler: 'PluginHandler',
          operation: 'handleEnable',
          pluginName,
        },
      });
    }
  }

  /**
   * 处理禁用命令
   */
  async handleDisable(args: string[]): Promise<void> {
    const pluginName = args[0];

    if (!pluginName) {
      throw AppError.fromCode(ErrorCodes.INVALID_INPUT, {
        category: ErrorCategory.VALIDATION,
        context: { handler: 'PluginHandler', operation: 'handleDisable' },
      });
    }

    if (this.options.verbose) {
      logger.info(`Disabling plugin: ${pluginName}`);
    }

    try {
      const plugin = this.plugins.find((p) => p.name === pluginName);
      if (!plugin) {
        throw new AppError(
          `Plugin not found: ${pluginName}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1005'
        );
      }

      plugin.enabled = false;
      await this.savePluginState(plugin);

      console.log(chalk.green('✓'), `Plugin ${pluginName} disabled`);
    } catch (error) {
      throw AppError.fromCode(ErrorCodes.EXECUTION_FAILED, {
        category: ErrorCategory.EXECUTION,
        cause: error instanceof Error ? error : undefined,
        context: {
          handler: 'PluginHandler',
          operation: 'handleDisable',
          pluginName,
        },
      });
    }
  }

  /**
   * 处理安装命令
   */
  async handleInstall(args: string[]): Promise<void> {
    const pluginName = args[0];

    if (!pluginName) {
      throw AppError.fromCode(ErrorCodes.INVALID_INPUT, {
        category: ErrorCategory.VALIDATION,
        context: { handler: 'PluginHandler', operation: 'handleInstall' },
      });
    }

    if (this.options.verbose) {
      logger.info(`Installing plugin: ${pluginName}`);
    }

    try {
      const newPlugin: PluginInfo = {
        name: pluginName,
        version: '1.0.0',
        description: `Plugin ${pluginName}`,
        enabled: true,
      };

      await this.downloadPlugin(newPlugin);
      this.plugins.push(newPlugin);

      console.log(chalk.green('✓'), `Plugin ${pluginName} installed`);
    } catch (error) {
      throw AppError.fromCode(ErrorCodes.EXECUTION_FAILED, {
        category: ErrorCategory.EXECUTION,
        cause: error instanceof Error ? error : undefined,
        context: {
          handler: 'PluginHandler',
          operation: 'handleInstall',
          pluginName,
        },
      });
    }
  }

  /**
   * 处理卸载命令
   */
  async handleUninstall(args: string[]): Promise<void> {
    const pluginName = args[0];

    if (!pluginName) {
      throw AppError.fromCode(ErrorCodes.INVALID_INPUT, {
        category: ErrorCategory.VALIDATION,
        context: { handler: 'PluginHandler', operation: 'handleUninstall' },
      });
    }

    if (this.options.verbose) {
      logger.info(`Uninstalling plugin: ${pluginName}`);
    }

    try {
      const index = this.plugins.findIndex((p) => p.name === pluginName);
      if (index === -1) {
        throw new AppError(
          `Plugin not found: ${pluginName}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1005'
        );
      }

      this.plugins.splice(index, 1);
      await this.removePluginFiles(pluginName);

      console.log(chalk.green('✓'), `Plugin ${pluginName} uninstalled`);
    } catch (error) {
      throw AppError.fromCode(ErrorCodes.EXECUTION_FAILED, {
        category: ErrorCategory.EXECUTION,
        cause: error instanceof Error ? error : undefined,
        context: {
          handler: 'PluginHandler',
          operation: 'handleUninstall',
          pluginName,
        },
      });
    }
  }

  /**
   * 加载插件列表
   */
  private async loadPlugins(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (this.plugins.length === 0) {
      this.plugins = [
        {
          name: 'example-plugin',
          version: '1.0.0',
          description: 'An example plugin',
          enabled: true,
          author: 'Liri Team',
        },
      ];
    }
  }

  /**
   * 保存插件状态
   */
  private async savePluginState(plugin: PluginInfo): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  /**
   * 下载插件
   */
  private async downloadPlugin(plugin: PluginInfo): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  /**
   * 移除插件文件
   */
  private async removePluginFiles(pluginName: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/**
 * 创建插件处理器
 */
export function createPluginHandler(
  options?: PluginHandlerOptions
): PluginHandler {
  return new PluginHandler(options);
}
