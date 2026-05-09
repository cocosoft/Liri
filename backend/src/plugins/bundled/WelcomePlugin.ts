/**
 * 欢迎插件（基于CC源码）
 * 提供欢迎信息和快速入门指南
 */

import type { Plugin, PluginMetadata } from '../types';
import { PluginStatus } from '../types/Plugin.js';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

export const WelcomePluginMetadata: PluginMetadata = {
  id: 'welcome',
  name: 'Welcome',
  version: '1.0.0',
  description: '欢迎插件，提供欢迎信息和快速入门指南',
  author: 'PY_APP Team',
  category: 'core',
  dependencies: [],
  enabledByDefault: true,
};

export class WelcomePlugin implements Plugin {
  status: PluginStatus = PluginStatus.ENABLED;
  private enabled = true;

  get metadata(): PluginMetadata {
    return WelcomePluginMetadata;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  async initialize(): Promise<void> {
    logger.info(`[WelcomePlugin] 初始化欢迎插件`);
  }

  async activate(): Promise<void> {
    this.enabled = true;
    logger.info(`[WelcomePlugin] 欢迎插件已激活`);
  }

  async deactivate(): Promise<void> {
    this.enabled = false;
    logger.info(`[WelcomePlugin] 欢迎插件已停用`);
  }

  async dispose(): Promise<void> {
    logger.info(`[WelcomePlugin] 欢迎插件已释放`);
  }

  /**
   * 获取欢迎信息
   */
  getWelcomeMessage(): string {
    return `
欢迎使用 PY_APP！

这是一个强大的 AI 辅助开发平台。

快速开始：
- 使用 /help 命令获取帮助
- 使用 /skills 查看可用技能
- 使用 /tools 查看可用工具

祝您使用愉快！
    `.trim();
  }

  /**
   * 获取快速入门指南
   */
  getQuickStartGuide(): string[] {
    return [
      '1. 输入您的任务描述',
      '2. AI 会分析并制定计划',
      '3. 执行工具完成任务',
      '4. 查看结果并继续',
    ];
  }
}

export function createWelcomePlugin(): Plugin {
  return new WelcomePlugin();
}
