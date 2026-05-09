/**
 * 帮助插件（基于CC源码）
 * 提供系统帮助和命令说明
 */

import type { Plugin, PluginMetadata } from '../types';
import { PluginStatus } from '../types/Plugin.js';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

export const HelpPluginMetadata: PluginMetadata = {
  id: 'help',
  name: 'Help',
  version: '1.0.0',
  description: '帮助插件，提供系统帮助和命令说明',
  author: 'PY_APP Team',
  category: 'core',
  dependencies: [],
  enabledByDefault: true,
};

export class HelpPlugin implements Plugin {
  status: PluginStatus = PluginStatus.ENABLED;
  private enabled = true;

  get metadata(): PluginMetadata {
    return HelpPluginMetadata;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  async initialize(): Promise<void> {
    logger.info(`[HelpPlugin] 初始化帮助插件`);
  }

  async activate(): Promise<void> {
    this.enabled = true;
    logger.info(`[HelpPlugin] 帮助插件已激活`);
  }

  async deactivate(): Promise<void> {
    this.enabled = false;
    logger.info(`[HelpPlugin] 帮助插件已停用`);
  }

  async dispose(): Promise<void> {
    logger.info(`[HelpPlugin] 帮助插件已释放`);
  }

  /**
   * 获取帮助信息
   */
  getHelp(topic?: string): string {
    if (!topic) {
      return this.getGeneralHelp();
    }

    switch (topic.toLowerCase()) {
      case 'commands':
        return this.getCommandsHelp();
      case 'skills':
        return this.getSkillsHelp();
      case 'tools':
        return this.getToolsHelp();
      case 'plugins':
        return this.getPluginsHelp();
      default:
        return `未找到帮助主题: ${topic}\n使用 /help 查看所有可用帮助主题`;
    }
  }

  private getGeneralHelp(): string {
    return `
PY_APP 帮助系统

可用命令：
/help - 显示此帮助信息
/help commands - 查看命令说明
/help skills - 查看技能说明
/help tools - 查看工具说明
/help plugins - 查看插件说明

/skills - 查看可用技能
/tools - 查看可用工具
/plugins - 查看已安装插件
/settings - 打开设置面板

/clear - 清除聊天记录
/exit - 退出应用
    `.trim();
  }

  private getCommandsHelp(): string {
    return `
命令说明

基础命令：
/help [topic]        - 显示帮助信息
/skills              - 列出所有可用技能
/tools               - 列出所有可用工具
/plugins             - 列出已安装插件
/settings            - 打开设置面板
/clear               - 清除聊天记录
/exit                - 退出应用

技能命令：
/skill <name> [args] - 执行指定技能

工具命令：
/tool <name> [args]  - 执行指定工具
    `.trim();
  }

  private getSkillsHelp(): string {
    return `
技能系统说明

技能是可复用的任务模板，用于执行特定类型的任务。

可用技能：
debug      - 调试日志分析
remember   - 记忆审查和整理
verify     - 代码和配置验证
simplify   - 代码和文档简化
skillify   - 将对话转化为技能
batch      - 批量处理任务
stuck      - 卡住时提供建议
loop       - 循环执行任务

使用方式：
直接输入技能名称即可调用，如：debug
    `.trim();
  }

  private getToolsHelp(): string {
    return `
工具系统说明

工具是执行特定操作的函数，包括文件操作、命令执行等。

核心工具：
bash       - 执行Bash命令
file_read  - 读取文件内容
file_write - 写入文件内容
file_edit  - 编辑文件内容
glob       - 文件匹配
grep       - 文本搜索

使用方式：
工具会根据上下文自动调用
    `.trim();
  }

  private getPluginsHelp(): string {
    return `
插件系统说明

插件扩展应用功能，可按需启用或禁用。

内置插件：
welcome    - 欢迎信息和快速入门
help       - 系统帮助和命令说明
settings   - 设置管理
status     - 系统状态监控

插件管理：
/plugins list        - 列出所有插件
/plugins enable <id> - 启用插件
/plugins disable <id> - 禁用插件
/plugins info <id>   - 查看插件信息
    `.trim();
  }
}

export function createHelpPlugin(): Plugin {
  return new HelpPlugin();
}
