//
/**
 * Hook CLI命令
 * 负责Hook的管理和操作
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { HookManager } from '../managers/HookManager';
import {
  readHookConfig,
  writeHookConfig,
  validateHookConfig,
} from '../utils/hooksSettings';
import { IndividualHookConfig } from '../types';

/**
 * 初始化Hook CLI命令
 * @param program Commander程序实例
 */
export function initHooksCommand(program: Command): void {
  const hookManager = HookManager.getInstance();
  const configPath = './settings.json';

  // 加载配置
  const config = readHookConfig(configPath);
  hookManager.loadConfig(config);

  const hooksCommand = program.command('hooks').description('Manage hooks');

  // 列出所有Hook
  hooksCommand
    .command('list')
    .description('List all configured hooks')
    .action(() => {
      const hooks = hookManager.getAllHooks();

      if (hooks.length === 0) {
        console.log(chalk.yellow('No hooks configured.'));
        return;
      }

      console.log(chalk.cyan('═'.repeat(80)));
      console.log(chalk.bold('  Hook List'));
      console.log(chalk.cyan('═'.repeat(80)));
      console.log();

      hooks.forEach((hook: unknown, index) => {
        const h = hook as Record<string, unknown>;
        const config = h.config as Record<string, unknown>;
        console.log(
          chalk.green(`#${index + 1}`),
          chalk.bold(h.event as string)
        );
        if (h.matcher) {
          console.log(chalk.gray('  Matcher:'), h.matcher as string);
        }
        console.log(chalk.gray('  Type:'), config.type as string);
        if (config.type === 'command') {
          console.log(chalk.gray('  Command:'), config.command as string);
        } else if (config.type === 'prompt') {
          console.log(chalk.gray('  Prompt:'), config.prompt as string);
        } else if (config.type === 'http') {
          const httpConfig = config.http as Record<string, unknown> | undefined;
          console.log(chalk.gray('  URL:'), httpConfig?.url as string);
        } else if (config.type === 'agent') {
          const agentConfig = config.agent as
            | Record<string, unknown>
            | undefined;
          console.log(chalk.gray('  Agent ID:'), agentConfig?.id as string);
        }
        console.log(
          chalk.gray('  Enabled:'),
          (config.enabled as boolean) ? 'Yes' : 'No'
        );
        console.log(
          chalk.gray('  Priority:'),
          (config.priority as number) || 0
        );
        console.log();
      });

      console.log(chalk.cyan('═'.repeat(80)));
    });

  // 添加新Hook
  hooksCommand
    .command('add')
    .description('Add a new hook')
    .option('-e, --event <event>', 'Hook event')
    .option('-m, --matcher <matcher>', 'Hook matcher')
    .option('-t, --type <type>', 'Hook type (command, prompt, http, agent)')
    .option('-c, --command <command>', 'Command for command type hook')
    .option('-p, --prompt <prompt>', 'Prompt for prompt type hook')
    .option('-u, --url <url>', 'URL for HTTP type hook')
    .option('-a, --agent <agent>', 'Agent ID for agent type hook')
    .option('--enabled [enabled]', 'Enable hook', true)
    .option('--priority [priority]', 'Hook priority', '0')
    .action((options) => {
      if (!options.event) {
        console.log(chalk.red('Error: Event is required.'));
        return;
      }

      if (!options.type) {
        console.log(chalk.red('Error: Type is required.'));
        return;
      }

      const hook: Record<string, unknown> = {
        event: options.event,
        matcher: options.matcher,
        config: {
          type: options.type,
          enabled: options.enabled,
          priority: parseInt(options.priority),
        },
      };

      // 根据类型添加特定配置
      if (options.type === 'command' && options.command) {
        (hook.config as Record<string, unknown>).command = options.command;
      } else if (options.type === 'prompt' && options.prompt) {
        (hook.config as Record<string, unknown>).prompt = options.prompt;
      } else if (options.type === 'http' && options.url) {
        (hook.config as Record<string, unknown>).http = { url: options.url };
      } else if (options.type === 'agent' && options.agent) {
        (hook.config as Record<string, unknown>).agent = { id: options.agent };
      }

      // 验证配置
      const validation = validateHookConfig(hook);
      if (!validation.valid) {
        console.log(chalk.red(`Error: ${validation.error}`));
        return;
      }

      // 读取现有配置
      const config = readHookConfig(configPath);
      config.hooks = config.hooks || [];
      config.hooks.push(hook);

      // 写入配置
      writeHookConfig(configPath, config);

      // 重新加载配置
      hookManager.loadConfig(config);

      console.log(chalk.green('✓ Hook added successfully!'));
    });

  // 移除Hook
  hooksCommand
    .command('remove <index>')
    .description('Remove a hook by index')
    .action((index) => {
      const config = readHookConfig(configPath);
      config.hooks = config.hooks || [];

      const hookIndex = parseInt(index) - 1;
      if (hookIndex < 0 || hookIndex >= config.hooks.length) {
        console.log(chalk.red('Error: Invalid hook index.'));
        return;
      }

      config.hooks.splice(hookIndex, 1);
      writeHookConfig(configPath, config);

      // 重新加载配置
      hookManager.loadConfig(config);

      console.log(chalk.green('✓ Hook removed successfully!'));
    });

  // 启用Hook
  hooksCommand
    .command('enable <index>')
    .description('Enable a hook by index')
    .action((index) => {
      const config = readHookConfig(configPath);
      config.hooks = config.hooks || [];

      const hookIndex = parseInt(index) - 1;
      if (hookIndex < 0 || hookIndex >= config.hooks.length) {
        console.log(chalk.red('Error: Invalid hook index.'));
        return;
      }

      config.hooks[hookIndex].config.enabled = true;
      writeHookConfig(configPath, config);

      // 重新加载配置
      hookManager.loadConfig(config);

      console.log(chalk.green('✓ Hook enabled successfully!'));
    });

  // 禁用Hook
  hooksCommand
    .command('disable <index>')
    .description('Disable a hook by index')
    .action((index) => {
      const config = readHookConfig(configPath);
      config.hooks = config.hooks || [];

      const hookIndex = parseInt(index) - 1;
      if (hookIndex < 0 || hookIndex >= config.hooks.length) {
        console.log(chalk.red('Error: Invalid hook index.'));
        return;
      }

      config.hooks[hookIndex].config.enabled = false;
      writeHookConfig(configPath, config);

      // 重新加载配置
      hookManager.loadConfig(config);

      console.log(chalk.green('✓ Hook disabled successfully!'));
    });

  // 显示Hook配置菜单
  hooksCommand.action(() => {
    console.log(chalk.cyan('═'.repeat(80)));
    console.log(chalk.bold('  Hook Configuration Menu'));
    console.log(chalk.cyan('═'.repeat(80)));
    console.log();
    console.log(chalk.green('Available commands:'));
    console.log(chalk.gray('  Liri hooks list    - List all configured hooks'));
    console.log(chalk.gray('  Liri hooks add     - Add a new hook'));
    console.log(chalk.gray('  Liri hooks remove  - Remove a hook by index'));
    console.log(chalk.gray('  Liri hooks enable  - Enable a hook by index'));
    console.log(chalk.gray('  Liri hooks disable - Disable a hook by index'));
    console.log();
    console.log(chalk.cyan('═'.repeat(80)));
  });
}
