/**
 * 伙伴插件（试点模块插件化）
 * 将 buddy 模块包装为标准 Plugin，使用 IPluginAPI 访问内核服务
 */
import type { Plugin, PluginMetadata } from '../types';
import { PluginStatus } from '../types/Plugin.js';
import type { IPluginAPI } from '../api/PluginAPI.js';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * BuddyPlugin 元数据
 */
export const BuddyPluginMetadata: PluginMetadata = {
  id: 'buddy',
  name: 'Buddy',
  version: '1.0.0',
  description: '伙伴模块插件，提供虚拟伙伴生成和交互功能（阶段2试点）',
  author: 'Liri Team',
  category: 'feature',
  dependencies: [],
  enabledByDefault: true,
};

/**
 * BuddyPlugin 实现对 buddy 模块的包装
 * 作为阶段2试点，验证标准 Plugin 接口 + IPluginAPI 的工作流
 */
export class BuddyPlugin implements Plugin {
  status: PluginStatus = PluginStatus.ENABLED;
  private enabled = true;
  private _api: IPluginAPI | null = null;

  get metadata(): PluginMetadata {
    return BuddyPluginMetadata;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 注入 IPluginAPI 实例
   * 由 PluginSystem 在注册后调用
   */
  setAPI(api: IPluginAPI): void {
    this._api = api;
  }

  /**
   * 获取当前 IPluginAPI 实例
   */
  getAPI(): IPluginAPI | null {
    return this._api;
  }

  async initialize(): Promise<void> {
    logger.info(`[BuddyPlugin] 初始化伙伴插件`);
  }

  async activate(): Promise<void> {
    this.enabled = true;
    logger.info(`[BuddyPlugin] 伙伴插件已激活`);

    if (this._api) {
      this._api.commands.registerCommand('buddy.create', async () => {
        return this.createBuddy();
      });
      this._api.commands.registerCommand('buddy.status', async () => {
        return this.getBuddyStatus();
      });

      logger.info(`[BuddyPlugin] 已注册 buddy.create, buddy.status 命令`);
    }
  }

  async deactivate(): Promise<void> {
    this.enabled = false;
    logger.info(`[BuddyPlugin] 伙伴插件已停用`);
  }

  async dispose(): Promise<void> {
    this._api = null;
    logger.info(`[BuddyPlugin] 伙伴插件已释放`);
  }

  /**
   * 创建虚拟伙伴
   * @returns 友好提示信息
   */
  createBuddy(): string {
    return '伙伴创建功能已通过 PluginAPI 注册（阶段2试点）';
  }

  /**
   * 获取伙伴状态
   * @returns 状态摘要
   */
  getBuddyStatus(): string {
    const apiInfo = this._api ? '已连接 PluginAPI' : '未连接 PluginAPI';
    return `伙伴插件状态: ${apiInfo}`;
  }
}

/**
 * 创建 BuddyPlugin 实例
 * @returns BuddyPlugin 实例
 */
export function createBuddyPlugin(): BuddyPlugin {
  return new BuddyPlugin();
}
