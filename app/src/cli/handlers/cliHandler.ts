//
/**
 * CLI主处理器
 * 统一协调所有子处理器，提供命令路由功能
 */

import chalk from 'chalk';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { t } from '@modules/system/i18n/extended';
import { AuthHandler, createAuthHandler } from './authHandler';
import { AgentHandler, createAgentHandler } from './agentHandler';
import { MCPHandler, createMCPHandler } from './mcpHandler';
import { PluginHandler, createPluginHandler } from './pluginHandler';
import { AutoModeHandler, createAutoModeHandler } from './autoModeHandler';
import { UtilHandler, createUtilHandler } from './utilHandler';
import { ConfigHandler, createConfigHandler } from './configHandler';
import { SessionHandler, createSessionHandler } from './sessionHandler';
import { DiagnoseHandler, createDiagnoseHandler } from './diagnoseHandler';
import { CommandAliasRegistry } from './CommandAliasRegistry';

export interface CLIHandlerOptions {
  verbose?: boolean;
  interactive?: boolean;
}

export interface CommandInfo {
  name: string;
  description: string;
  handler: string;
  subcommands?: string[];
}

export class CLIHandler {
  private options: CLIHandlerOptions;
  private aliasRegistry: CommandAliasRegistry;
  private authHandler: AuthHandler;
  private agentHandler: AgentHandler;
  private mcpHandler: MCPHandler;
  private pluginHandler: PluginHandler;
  private autoModeHandler: AutoModeHandler;
  private utilHandler: UtilHandler;
  private configHandler: ConfigHandler;
  private sessionHandler: SessionHandler;
  private diagnoseHandler: DiagnoseHandler;

  private commands: Record<string, CommandInfo> = {
    auth: {
      name: 'auth',
      description: '管理OAuth认证',
      handler: 'auth',
      subcommands: ['login', 'logout', 'status', 'list'],
    },
    login: { name: 'login', description: '登录到PY_APP', handler: 'auth' },
    logout: { name: 'logout', description: '登出PY_APP', handler: 'auth' },
    status: { name: 'status', description: '检查认证状态', handler: 'auth' },
    refresh: { name: 'refresh', description: '刷新认证令牌', handler: 'auth' },
    agents: {
      name: 'agents',
      description: '管理Agent',
      handler: 'agent',
      subcommands: ['list', 'start', 'stop', 'restart', 'create'],
    },
    mcp: {
      name: 'mcp',
      description: '管理MCP服务器',
      handler: 'mcp',
      subcommands: ['list', 'connect', 'disconnect'],
    },
    plugins: {
      name: 'plugins',
      description: '管理插件',
      handler: 'plugin',
      subcommands: ['list', 'install', 'uninstall', 'enable', 'disable'],
    },
    auto: {
      name: 'auto',
      description: '自动模式',
      handler: 'auto',
      subcommands: ['start', 'stop', 'status', 'config'],
    },
    help: { name: 'help', description: '显示帮助信息', handler: 'util' },
    version: { name: 'version', description: '显示版本信息', handler: 'util' },
    clear: { name: 'clear', description: '清屏', handler: 'util' },
    echo: { name: 'echo', description: '回显输入', handler: 'util' },
    which: { name: 'which', description: '显示命令位置', handler: 'util' },
    env: { name: 'env', description: '显示环境变量', handler: 'util' },
    debug: { name: 'debug', description: '调试模式', handler: 'util' },

    config: {
      name: 'config',
      description: '管理配置',
      handler: 'config',
      subcommands: ['get', 'set', 'list', 'reset'],
    },
    sessions: {
      name: 'sessions',
      description: '管理会话',
      handler: 'session',
      subcommands: ['list', 'inspect', 'export'],
    },
    diagnose: {
      name: 'diagnose',
      description: '系统诊断',
      handler: 'diagnose',
      subcommands: ['network', 'health', 'debug', 'slow-query'],
    },
  };

  constructor(options?: CLIHandlerOptions) {
    this.options = { verbose: false, interactive: true, ...options };
    this.aliasRegistry = new CommandAliasRegistry();

    this.authHandler = createAuthHandler({ verbose: this.options.verbose });
    this.agentHandler = createAgentHandler({ verbose: this.options.verbose });
    this.mcpHandler = createMCPHandler({ verbose: this.options.verbose });
    this.pluginHandler = createPluginHandler({ verbose: this.options.verbose });
    this.autoModeHandler = createAutoModeHandler({
      verbose: this.options.verbose,
    });
    this.utilHandler = createUtilHandler({ verbose: this.options.verbose });
    this.configHandler = createConfigHandler({ verbose: this.options.verbose });
    this.sessionHandler = createSessionHandler({
      verbose: this.options.verbose,
    });
    this.diagnoseHandler = createDiagnoseHandler({
      verbose: this.options.verbose,
    });
  }

  /**
   * 解析并执行命令
   * @param commandLine 命令行输入
   * @returns 是否成功执行
   */
  async execute(commandLine: string): Promise<boolean> {
    let resolvedLine = commandLine;
    if (this.aliasRegistry.isAlias(commandLine)) {
      const resolved = this.aliasRegistry.resolveAlias(commandLine);
      if (resolved) {
        console.log(chalk.gray('↳'), resolved.resolved);
        resolvedLine = resolved.resolved;
      }
    }

    const { command, args } = this.parseCommand(resolvedLine);

    if (!command) {
      return true;
    }

    const commandInfo = this.commands[command];
    if (!commandInfo) {
      console.error(chalk.red('✗'), t('command.unknown', { cmd: command }));
      await this.showHelp();
      return false;
    }

    try {
      await this.routeCommand(commandInfo, command, args);
      return true;
    } catch (error) {
      console.error(
        chalk.red('✗'),
        t('error.internal', { detail: String(error) })
      );
      return false;
    }
  }

  /**
   * 解析命令行
   */
  private parseCommand(commandLine: string): {
    command: string;
    args: string[];
  } {
    const parts = commandLine.trim().split(/\s+/);
    return {
      command: parts[0] || '',
      args: parts.slice(1),
    };
  }

  /**
   * 路由命令到对应的处理器
   */
  private async routeCommand(
    commandInfo: CommandInfo,
    command: string,
    args: string[]
  ): Promise<void> {
    switch (commandInfo.handler) {
      case 'auth':
        await this.handleAuthCommand(command, args);
        break;
      case 'agent':
        await this.handleAgentCommand(command, args);
        break;
      case 'mcp':
        await this.handleMCPCommand(command, args);
        break;
      case 'plugin':
        await this.handlePluginCommand(command, args);
        break;
      case 'auto':
        await this.handleAutoCommand(command, args);
        break;
      case 'util':
        await this.handleUtilCommand(command, args);
        break;
      case 'config':
        await this.handleConfigCommand(command, args);
        break;
      case 'session':
        await this.handleSessionCommand(command, args);
        break;
      case 'diagnose':
        await this.handleDiagnoseCommand(command, args);
        break;
      default:
        throw new AppError(
          `Unknown handler: ${commandInfo.handler}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1004'
        );
    }
  }

  /**
   * 处理认证命令
   */
  private async handleAuthCommand(
    command: string,
    args: string[]
  ): Promise<void> {
    switch (command) {
      case 'auth': {
        const subcommand = args[0];
        const subargs = args.slice(1);
        switch (subcommand) {
          case 'login':
            await this.authHandler.handleLogin(subargs);
            break;
          case 'logout':
            await this.authHandler.handleLogout(subargs);
            break;
          case 'status':
            await this.authHandler.handleStatus();
            break;
          case 'list':
            await this.authHandler.handleList();
            break;
          default:
            console.log(
              chalk.yellow('⚠'),
              t('command.unknown', { cmd: `auth ${subcommand}` })
            );
            console.log('  auth login <provider>  - OAuth 登录');
            console.log('  auth logout [provider] - 登出');
            console.log('  auth status           - 查看认证状态');
            console.log('  auth list             - 查看 Provider 列表');
        }
        break;
      }
      case 'login':
        await this.authHandler.handleLogin(args);
        break;
      case 'logout':
        await this.authHandler.handleLogout(args);
        break;
      case 'status':
        await this.authHandler.handleStatus();
        break;
      case 'refresh':
        await this.authHandler.handleRefresh();
        break;
    }
  }

  /**
   * 处理Agent命令
   */
  private async handleAgentCommand(
    command: string,
    args: string[]
  ): Promise<void> {
    const subcommand = args[0];
    const subargs = args.slice(1);

    switch (subcommand) {
      case 'list':
        await this.agentHandler.handleList();
        break;
      case 'start':
        await this.agentHandler.handleStart(subargs);
        break;
      case 'stop':
        await this.agentHandler.handleStop(subargs);
        break;
      case 'restart':
        await this.agentHandler.handleRestart(subargs);
        break;
      case 'create':
        await this.agentHandler.handleCreate(subargs);
        break;
      default:
        console.log(
          chalk.yellow('⚠'),
          t('command.unknown', { cmd: `agent ${subcommand}` })
        );
        await this.showAgentHelp();
    }
  }

  /**
   * 处理MCP命令
   */
  private async handleMCPCommand(
    command: string,
    args: string[]
  ): Promise<void> {
    const subcommand = args[0];
    const subargs = args.slice(1);

    switch (subcommand) {
      case 'list':
        await this.mcpHandler.handleList();
        break;
      case 'connect':
        await this.mcpHandler.handleConnect(subargs);
        break;
      case 'disconnect':
        await this.mcpHandler.handleDisconnect(subargs);
        break;
      default:
        console.log(
          chalk.yellow('⚠'),
          t('command.unknown', { cmd: `mcp ${subcommand}` })
        );
        await this.showMCPHelp();
    }
  }

  /**
   * 处理插件命令
   */
  private async handlePluginCommand(
    command: string,
    args: string[]
  ): Promise<void> {
    const subcommand = args[0];
    const subargs = args.slice(1);

    switch (subcommand) {
      case 'list':
        await this.pluginHandler.handleList();
        break;
      case 'install':
        await this.pluginHandler.handleInstall(subargs);
        break;
      case 'uninstall':
        await this.pluginHandler.handleUninstall(subargs);
        break;
      case 'enable':
        await this.pluginHandler.handleEnable(subargs);
        break;
      case 'disable':
        await this.pluginHandler.handleDisable(subargs);
        break;
      default:
        console.log(
          chalk.yellow('⚠'),
          t('command.unknown', { cmd: `plugin ${subcommand}` })
        );
        await this.showPluginHelp();
    }
  }

  /**
   * 处理自动模式命令
   */
  private async handleAutoCommand(
    command: string,
    args: string[]
  ): Promise<void> {
    const subcommand = args[0];
    const subargs = args.slice(1);

    switch (subcommand) {
      case 'start':
        await this.autoModeHandler.handleStart(subargs);
        break;
      case 'stop':
        await this.autoModeHandler.handleStop();
        break;
      case 'status':
        await this.autoModeHandler.handleStatus();
        break;
      case 'config':
        await this.autoModeHandler.handleConfig(subargs);
        break;
      default:
        console.log(
          chalk.yellow('⚠'),
          t('command.unknown', { cmd: `auto ${subcommand}` })
        );
        await this.showAutoHelp();
    }
  }

  /**
   * 处理工具命令
   */
  private async handleUtilCommand(
    command: string,
    args: string[]
  ): Promise<void> {
    switch (command) {
      case 'help':
        await this.utilHandler.showHelp(args);
        break;
      case 'version':
        await this.utilHandler.showVersion();
        break;
      case 'clear':
        await this.utilHandler.clearScreen();
        break;
      case 'echo':
        await this.utilHandler.echo(args);
        break;
      case 'which':
        await this.utilHandler.which(args);
        break;
      case 'env':
        await this.utilHandler.showEnv(args);
        break;
      case 'debug':
        await this.utilHandler.debug(args);
        break;
    }
  }

  /**
   * 处理配置命令
   */
  private async handleConfigCommand(
    command: string,
    args: string[]
  ): Promise<void> {
    const subcommand = args[0];
    const subargs = args.slice(1);

    const handled = await this.configHandler.handle(subcommand, subargs);
    if (!handled) {
      console.log(
        chalk.yellow('⚠'),
        t('command.unknown', { cmd: `config ${subcommand}` })
      );
      await this.showConfigHelp();
    }
  }

  /**
   * 处理会话命令
   */
  private async handleSessionCommand(
    command: string,
    args: string[]
  ): Promise<void> {
    const subcommand = args[0];
    const subargs = args.slice(1);

    const handled = await this.sessionHandler.handle(subcommand, subargs);
    if (!handled) {
      console.log(
        chalk.yellow('⚠'),
        t('command.unknown', { cmd: `session ${subcommand}` })
      );
      await this.showSessionHelp();
    }
  }

  /**
   * 处理诊断命令
   */
  private async handleDiagnoseCommand(
    command: string,
    args: string[]
  ): Promise<void> {
    const subcommand = args[0];
    const subargs = args.slice(1);

    const handled = await this.diagnoseHandler.handle(subcommand, subargs);
    if (!handled) {
      console.log(
        chalk.yellow('⚠'),
        t('command.unknown', { cmd: `diagnose ${subcommand}` })
      );
      await this.showDiagnoseHelp();
    }
  }

  /**
   * 显示配置帮助
   */
  async showConfigHelp(): Promise<void> {
    this.configHandler.showHelp();
  }

  /**
   * 显示会话帮助
   */
  async showSessionHelp(): Promise<void> {
    this.sessionHandler.showHelp();
  }

  /**
   * 显示诊断帮助
   */
  async showDiagnoseHelp(): Promise<void> {
    this.diagnoseHandler.showHelp();
  }

  /**
   * 显示帮助信息
   */
  async showHelp(): Promise<void> {
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold(`  ${t('app.name')} CLI ${t('help.welcome')}`));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log();

    const sortedCommands = Object.values(this.commands).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    console.log(chalk.bold(`  ${t('help.commands_header')}`));
    console.log();
    for (const cmd of sortedCommands) {
      console.log(chalk.green(cmd.name.padEnd(15)) + cmd.description);
      if (cmd.subcommands && cmd.subcommands.length > 0) {
        console.log(
          chalk.gray(
            `     ${t('prompt.choose')}: ${cmd.subcommands.join(', ')}`
          )
        );
      }
    }

    console.log();
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.gray(t('help.suggestion')));
  }

  /**
   * 显示Agent帮助
   */
  async showAgentHelp(): Promise<void> {
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold('  agents - Manage Agents'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log();
    console.log(chalk.green('Usage:'));
    console.log(chalk.gray('  agents list              - List all agents'));
    console.log(chalk.gray('  agents start <name>      - Start an agent'));
    console.log(chalk.gray('  agents stop <name>       - Stop an agent'));
    console.log(chalk.gray('  agents restart <name>    - Restart an agent'));
    console.log(chalk.gray('  agents create <name>     - Create a new agent'));
    console.log(chalk.cyan('═'.repeat(60)));
  }

  /**
   * 显示MCP帮助
   */
  async showMCPHelp(): Promise<void> {
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold('  mcp - Manage MCP Servers'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log();
    console.log(chalk.green('Usage:'));
    console.log(
      chalk.gray('  mcp list                 - List all MCP servers')
    );
    console.log(
      chalk.gray('  mcp connect <name> [url] - Connect to an MCP server')
    );
    console.log(
      chalk.gray('  mcp disconnect <name>    - Disconnect from an MCP server')
    );
    console.log(chalk.cyan('═'.repeat(60)));
  }

  /**
   * 显示插件帮助
   */
  async showPluginHelp(): Promise<void> {
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold('  plugins - Manage Plugins'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log();
    console.log(chalk.green('Usage:'));
    console.log(chalk.gray('  plugins list             - List all plugins'));
    console.log(chalk.gray('  plugins install <name>   - Install a plugin'));
    console.log(chalk.gray('  plugins uninstall <name> - Uninstall a plugin'));
    console.log(chalk.gray('  plugins enable <name>    - Enable a plugin'));
    console.log(chalk.gray('  plugins disable <name>   - Disable a plugin'));
    console.log(chalk.cyan('═'.repeat(60)));
  }

  /**
   * 显示自动模式帮助
   */
  async showAutoHelp(): Promise<void> {
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold('  auto - Auto Mode'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log();
    console.log(chalk.green('Usage:'));
    console.log(chalk.gray('  auto start [config]      - Start auto mode'));
    console.log(chalk.gray('  auto stop                - Stop auto mode'));
    console.log(
      chalk.gray('  auto status              - Check auto mode status')
    );
    console.log(chalk.gray('  auto config <key> <val>  - Configure auto mode'));
    console.log(chalk.cyan('═'.repeat(60)));
  }

  /**
   * 获取所有命令列表
   */
  getCommands(): CommandInfo[] {
    return Object.values(this.commands);
  }

  /**
   * 获取命令信息
   */
  getCommandInfo(command: string): CommandInfo | undefined {
    return this.commands[command];
  }
}

/**
 * 创建CLI处理器
 */
export function createCLIHandler(options?: CLIHandlerOptions): CLIHandler {
  return new CLIHandler(options);
}
