/**
 * CanvasToolPlugin
 * 将 CanvasTool 包装为标准 Plugin，通过 PluginAPI 注册画布工具
 */
import type { Plugin, PluginMetadata } from '../types';
import { PluginStatus } from '../types/Plugin.js';
import type { IPluginAPI } from '../api/PluginAPI.js';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { CanvasTool } from '../../tools/CanvasTool/CanvasTool.js';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * CanvasToolPlugin 元数据
 */
export const CanvasToolPluginMetadata: PluginMetadata = {
  id: 'canvas',
  name: 'CanvasTool',
  version: '1.0.0',
  description: '画布工具模块插件，提供画布创建、绘制和导出功能（阶段4推广）',
  author: 'Liri Team',
  category: 'tool',
  dependencies: ['tools'] as any,
  enabledByDefault: true,
};

/**
 * CanvasToolPlugin 实现对 CanvasTool 的包装
 * 阶段4推广：验证工具类模块的插件化模式
 */
export class CanvasToolPlugin implements Plugin {
  status: PluginStatus = PluginStatus.ENABLED;
  private enabled = true;
  private _api: IPluginAPI | null = null;
  private _canvasTool: CanvasTool | null = null;

  get metadata(): PluginMetadata {
    return CanvasToolPluginMetadata;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setAPI(api: IPluginAPI): void {
    this._api = api;
  }

  getAPI(): IPluginAPI | null {
    return this._api;
  }

  async initialize(): Promise<void> {
    this._canvasTool = new CanvasTool();
    logger.info(`[CanvasToolPlugin] 画布工具已创建`);
  }

  async activate(): Promise<void> {
    this.enabled = true;
    logger.info(`[CanvasToolPlugin] 已激活`);

    if (this._api && this._canvasTool) {
      this._api.tools.registerTool({
        id: this._canvasTool.name,
        name: this._canvasTool.name,
        description: this._canvasTool.description,
        handler: this._canvasTool.execute.bind(this._canvasTool) as any,
        schema: (this._canvasTool as any).schema,
      });

      this._api.commands.registerCommand('canvas.help', async () => {
        return this.getHelpText();
      });

      logger.info(`[CanvasToolPlugin] 已注册 canvas 工具和 canvas.help 命令`);
    }
  }

  async deactivate(): Promise<void> {
    this.enabled = false;
    logger.info(`[CanvasToolPlugin] 已停用`);
  }

  async dispose(): Promise<void> {
    this._canvasTool = null;
    this._api = null;
    logger.info(`[CanvasToolPlugin] 已释放`);
  }

  /**
   * 获取画布工具帮助信息
   */
  getHelpText(): string {
    return `CanvasTool 支持以下操作: create, resize, draw, text, clear, export, import

使用 PluginAPI 注册为画布工具，可通过 tools 域访问。`;
  }
}

/**
 * 创建 CanvasToolPlugin 实例
 */
export function createCanvasToolPlugin(): CanvasToolPlugin {
  return new CanvasToolPlugin();
}
