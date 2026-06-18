/**
 * 配置处理器
 * 处理 config 命令组，提供配置的查看、修改、重置等操作
 */

import chalk from 'chalk';
import { t } from '@modules/system/i18n/extended';
import { getLogger } from '@modules/monitoring/logs/Logger';
import {
  CliConfigManager,
  createCliConfigManager,
  ConfigOptions,
} from '@modules/cli/config';

const logger = getLogger('configHandler');

export interface ConfigHandlerOptions {
  verbose?: boolean;
}

export class ConfigHandler {
  private configManager: CliConfigManager;
  private options: ConfigHandlerOptions;

  constructor(options?: ConfigHandlerOptions) {
    this.options = { verbose: false, ...options };
    this.configManager = createCliConfigManager();
  }

  /**
   * 主分发方法
   */
  async handle(command: string, args: string[]): Promise<boolean> {
    switch (command) {
      case 'get':
        await this.handleGet(args);
        return true;
      case 'set':
        await this.handleSet(args);
        return true;
      case 'list':
        await this.handleList();
        return true;
      case 'reset':
        await this.handleReset(args);
        return true;
      default:
        return false;
    }
  }

  /**
   * 获取配置项
   * config get <key>
   */
  async handleGet(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.log(chalk.yellow('⚠'), t('config.get_usage'));
      console.log(
        chalk.gray(`   ${t('common.example')}: config get cli.prompt`)
      );
      return;
    }

    const key = args[0];
    const value = this.configManager.get(key);

    if (value === undefined) {
      console.log(chalk.yellow('⚠'), t('config.not_found', { key }));
      return;
    }

    if (this.options.verbose) {
      logger.info('获取配置项', {
        key,
        configPath: this.configManager.getConfigPath(),
      });
    }

    console.log(chalk.green('✓'), `${key} = ${formatValue(value)}`);
  }

  /**
   * 设置配置项
   * config set <key> <value>
   */
  async handleSet(args: string[]): Promise<void> {
    if (args.length < 2) {
      console.log(chalk.yellow('⚠'), t('config.set_usage'));
      console.log(
        chalk.gray(`   ${t('common.example')}: config set cli.prompt "pyapp> "`)
      );
      return;
    }

    const key = args[0];
    const rawValue = args.slice(1).join(' ');
    const parsedValue = parseValue(rawValue);

    const success = this.configManager.set(key, parsedValue);

    if (success) {
      if (this.options.verbose) {
        logger.info('配置项已更新', { key, value: parsedValue });
      }
      console.log(
        chalk.green('✓'),
        t('config.updated', { key, value: formatValue(parsedValue) })
      );
    } else {
      console.log(chalk.red('✕'), t('config.update_failed', { key }));
    }
  }

  /**
   * 列出所有配置
   * config list
   */
  async handleList(): Promise<void> {
    const config = this.configManager.getConfig();

    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold(`  ${t('config.list_header')}`));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log();

    printConfigTree(config, '');

    console.log();
    console.log(
      chalk.gray(
        `${t('config.file_path')}: ${this.configManager.getConfigPath()}`
      )
    );
    console.log(chalk.cyan('═'.repeat(60)));
  }

  /**
   * 重置配置项或全部配置
   * config reset [key]
   */
  async handleReset(args: string[]): Promise<void> {
    if (args.length === 0) {
      this.configManager.reset();
      console.log(chalk.green('✓'), t('config.reset_all'));
      if (this.options.verbose) {
        logger.info('全部配置已重置');
      }
      return;
    }

    // 部分重置：将指定路径设为对应 Schema 默认值
    const key = args[0];
    const success = this.configManager.set(key, undefined);
    if (success) {
      console.log(chalk.green('✓'), t('config.reset_key', { key }));
    } else {
      console.log(chalk.yellow('⚠'), t('config.reset_failed', { key }));
    }
  }

  /**
   * 显示配置帮助
   */
  showHelp(): void {
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold(`  config - ${t('config.help_description')}`));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log();
    console.log(chalk.green(t('command.help')));
    console.log(chalk.gray('  config get <key>          - ', t('config.get')));
    console.log(chalk.gray('  config set <key> <value>  - ', t('config.set')));
    console.log(chalk.gray('  config list               - ', t('config.list')));
    console.log(
      chalk.gray('  config reset [key]        - ', t('config.reset'))
    );
    console.log();
    console.log(chalk.green(t('common.example')));
    console.log(chalk.gray('  config get cli.prompt'));
    console.log(chalk.gray('  config set cli.prompt "pyapp> "'));
    console.log(chalk.gray('  config list'));
    console.log(chalk.cyan('═'.repeat(60)));
  }
}

/**
 * 格式化配置值为可读字符串
 */
function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return chalk.green(`"${value}"`);
  }
  if (typeof value === 'boolean') {
    return chalk.blue(String(value));
  }
  if (typeof value === 'number') {
    return chalk.magenta(String(value));
  }
  if (value === null || value === undefined) {
    return chalk.gray('null');
  }
  if (Array.isArray(value)) {
    return chalk.cyan(JSON.stringify(value));
  }
  return chalk.cyan(JSON.stringify(value, null, 2));
}

/**
 * 将配置树打印为缩进结构
 */
function printConfigTree(obj: Record<string, unknown>, prefix: string): void {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      console.log(chalk.cyan(`  ${fullKey}:`));
      printConfigTree(value as Record<string, unknown>, fullKey);
    } else {
      console.log(`  ${chalk.cyan(fullKey)} = ${formatValue(value)}`);
    }
  }
}

/**
 * 解析字符串值为对应类型
 */
function parseValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (raw === 'undefined') return undefined;

  const num = Number(raw);
  if (!isNaN(num) && raw.trim() !== '') return num;

  // 尝试 JSON 解析
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * 创建配置处理器
 */
export function createConfigHandler(
  options?: ConfigHandlerOptions
): ConfigHandler {
  return new ConfigHandler(options);
}
