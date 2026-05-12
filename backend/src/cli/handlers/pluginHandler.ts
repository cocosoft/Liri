/**
 * 插件处理器
 * 处理CLI中的插件相关命令
 */

import chalk from 'chalk';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { ErrorCodes } from '@modules/error/ErrorCodes';

const logger = new Logger({ level: LogLevel.INFO });

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
        throw new AppError(`Plugin not found: ${pluginName}`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1005');
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
        throw new AppError(`Plugin not found: ${pluginName}`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1005');
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
        throw new AppError(`Plugin not found: ${pluginName}`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1005');
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
          author: 'PY_APP Team',
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
