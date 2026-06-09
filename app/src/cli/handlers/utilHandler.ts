/**
 * 工具处理器
 * 提供通用工具命令处理
 */

import { CLIHandler } from './cliHandler.js';
import { configManager } from '@modules/config';

export interface UtilHandlerOptions {
  verbose?: boolean;
}

export class UtilHandler {
  private verbose: boolean;

  constructor(options: UtilHandlerOptions = {}) {
    this.verbose = options.verbose ?? false;
  }

  async handle(command: string, args: string[]): Promise<boolean> {
    switch (command) {
      case 'help':
        await this.showHelp(args);
        return true;
      case 'version':
        await this.showVersion();
        return true;
      case 'clear':
        await this.clearScreen();
        return true;
      case 'echo':
        await this.echo(args);
        return true;
      case 'which':
        await this.which(args);
        return true;
      case 'env':
        await this.showEnv(args);
        return true;
      case 'debug':
        await this.debug(args);
        return true;
      default:
        return false;
    }
  }

  async showHelp(args: string[] = []) {
    if (args.length === 0) {
      this.printGeneralHelp();
    } else {
      const command = args[0];
      this.printCommandHelp(command);
    }
  }

  private printGeneralHelp() {
    console.log(`\nLiri CLI 帮助信息

命令列表:
  auth          - 认证相关命令
  agent         - 代理相关命令
  mcp           - MCP相关命令
  plugin        - 插件相关命令
  auto          - 自动模式命令
  config        - 管理配置
  sessions      - 管理会话
  diagnose      - 系统诊断
  help [命令]   - 显示帮助信息
  version       - 显示版本信息
  clear         - 清空屏幕
  echo <文本>   - 输出文本
  which <命令>  - 查找命令位置
  env [变量名]  - 显示环境变量
  debug         - 调试模式

使用 'help <命令>' 获取详细帮助。\n`);
  }

  private printCommandHelp(command: string) {
    const helpText: Record<string, string> = {
      auth: `auth - 认证相关命令

用法:
  auth login       - 登录账户
  auth logout      - 登出账户
  auth status      - 查看认证状态
  auth refresh     - 刷新令牌`,
      agent: `agent - 代理相关命令

用法:
  agent start      - 启动代理
  agent stop       - 停止代理
  agent status     - 查看代理状态
  agent list       - 列出所有代理`,
      mcp: `mcp - MCP相关命令

用法:
  mcp start        - 启动MCP服务器
  mcp stop         - 停止MCP服务器
  mcp status       - 查看MCP状态`,
      plugin: `plugin - 插件相关命令

用法:
  plugin install   - 安装插件
  plugin uninstall - 卸载插件
  plugin list      - 列出已安装插件
  plugin enable    - 启用插件
  plugin disable   - 禁用插件`,
      auto: `auto - 自动模式命令

用法:
  auto start       - 启动自动模式
  auto stop        - 停止自动模式
  auto config      - 配置自动模式`,
      config: `config - 管理配置

用法:
  config get <key>          - 获取配置项
  config set <key> <value>  - 设置配置项
  config list               - 列出所有配置
  config reset [key]        - 重置配置

示例:
  config get cli.prompt
  config set cli.prompt "pyapp> "`,
      sessions: `sessions - 管理会话

用法:
  sessions list               - 列出所有会话
  sessions inspect <id>       - 查看会话详情
  sessions export <id> [opts] - 导出会话

导出选项:
  --format json   JSON 格式 (默认)
  --format md     Markdown 格式`,
      diagnose: `diagnose - 系统诊断

用法:
  diagnose network               - 网络连通性检测
  diagnose health                - 系统健康检查
  diagnose debug [scope]         - 调试信息
  diagnose slow-query [threshold] - 慢查询检测报告

调试范围:
  all      全部信息 (默认)
  system   系统信息
  config   配置信息
  session  会话信息

慢查询参数:
  threshold   阈值（毫秒），默认 5000`,
    };

    console.log(helpText[command] || `未找到命令 '${command}' 的帮助信息`);
  }

  async showVersion() {
    const { readFileSync, existsSync } = await import('fs');
    const { join } = await import('path');
    const { resolveProjectRoot } = await import('@modules/core/paths');
    const packagePath = join(resolveProjectRoot(), 'package.json');
    let version = '0.0.0';
    if (existsSync(packagePath)) {
      try {
        const content = readFileSync(packagePath, 'utf8');
        const pkg = JSON.parse(content);
        version = pkg.version || '0.0.0';
      } catch {
        version = '0.0.0';
      }
    }
    console.log(`Liri v${version}`);
    console.log(`官网: https://openliri.com`);
  }

  async clearScreen() {
    console.clear();
  }

  async echo(args: string[]) {
    console.log(args.join(' '));
  }

  async which(args: string[]) {
    if (args.length === 0) {
      console.log('请指定要查找的命令');
      return;
    }

    const command = args[0];
    const handlers = [
      'auth',
      'agent',
      'mcp',
      'plugin',
      'auto',
      'help',
      'version',
      'clear',
      'echo',
      'which',
      'env',
      'debug',
    ];

    if (handlers.includes(command)) {
      console.log(`命令 '${command}' 是内置命令`);
    } else {
      console.log(`未找到命令 '${command}'`);
    }
  }

  async showEnv(args: string[]) {
    if (args.length === 0) {
      for (const [key, value] of Object.entries(process.env)) {
        console.log(`${key}=${value}`);
      }
    } else {
      const varName = args[0];
      const value = process.env[varName];
      console.log(value ?? `环境变量 '${varName}' 未设置`);
    }
  }

  async debug(args: string[]) {
    if (args.includes('on')) {
      process.env.Liri_DEBUG = 'true';
      console.log('调试模式已开启');
    } else if (args.includes('off')) {
      delete process.env.Liri_DEBUG;
      console.log('调试模式已关闭');
    } else {
      const status = configManager.env('Liri_DEBUG') ? '开启' : '关闭';
      console.log(`调试模式: ${status}`);
      console.log(`Node版本: ${process.version}`);
      console.log(`平台: ${process.platform}`);
      console.log(`架构: ${process.arch}`);
    }
  }

  getSupportedCommands(): string[] {
    return ['help', 'version', 'clear', 'echo', 'which', 'env', 'debug'];
  }
}

export function createUtilHandler(options?: UtilHandlerOptions): UtilHandler {
  return new UtilHandler(options);
}
