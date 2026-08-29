/**
 * MediaPlugin
 * 多媒体 Bundled 插件
 * 将 image/voice 工具封装为插件接口，供插件系统发现和调用
 */
import type { Plugin, PluginMetadata } from '../types';
import { PluginStatus } from '../types/Plugin.js';
import type { IPluginAPI } from '../api/PluginAPI.js';
import { getLogger } from '@modules/monitoring';
import { ImageGenerateTool, ImageAnalysisTool } from '@modules/tools';
import type { ToolUseContext } from '../../tools/types/ToolUseContext';

const logger = getLogger('plugins:bundled:mediaPlugin');

/**
 * MediaPlugin 元数据
 */
export const MediaPluginMetadata: PluginMetadata = {
  id: 'media',
  name: 'MediaPlugin',
  version: '1.0.0',
  description: '多媒体插件，提供图片生成、分析和语音能力',
  author: 'Liri Team',
  category: 'image_generation',
  dependencies: [{ name: 'tools' }],
  enabledByDefault: true,
};

/**
 * MediaPlugin
 * 将 ImageGenerateTool / ImageAnalysisTool 包装为插件接口
 */
export class MediaPlugin implements Plugin {
  status: PluginStatus = PluginStatus.ENABLED;
  private enabled = true;
  private _api: IPluginAPI | null = null;
  private _imageGenerateTool: ImageGenerateTool | null = null;
  private _imageAnalysisTool: ImageAnalysisTool | null = null;

  get metadata(): PluginMetadata {
    return MediaPluginMetadata;
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
    this._imageGenerateTool = new ImageGenerateTool();
    this._imageAnalysisTool = new ImageAnalysisTool();
    logger.info('[MediaPlugin] 多媒体工具已创建');
  }

  async activate(): Promise<void> {
    this.enabled = true;
    logger.info('[MediaPlugin] 已激活');

    if (this._api) {
      if (this._imageGenerateTool) {
        this._api.tools.registerTool(this._imageGenerateTool as any);
      }
      if (this._imageAnalysisTool) {
        this._api.tools.registerTool(this._imageAnalysisTool as any);
      }

      this._api.commands.registerCommand('media.help', async () => {
        return this.getHelpText();
      });

      logger.info('[MediaPlugin] 已注册图片生成/分析工具和 media.help 命令');
    }
  }

  async deactivate(): Promise<void> {
    this.enabled = false;
    logger.info('[MediaPlugin] 已停用');
  }

  async dispose(): Promise<void> {
    this._imageGenerateTool = null;
    this._imageAnalysisTool = null;
    this._api = null;
    logger.info('[MediaPlugin] 已释放');
  }

  /**
   * 生成图片（IImageGenerationPlugin 兼容接口）
   */
  async generateImage(params: {
    prompt: string;
    size?: string;
    n?: number;
  }): Promise<{ url: string; alt: string }[]> {
    if (!this._imageGenerateTool) {
      throw new Error('ImageGenerateTool 未初始化');
    }

    const result = await this._imageGenerateTool.execute(
      params,
      {} as ToolUseContext
    );
    if (!result.success || !result.data) {
      throw new Error(`图片生成失败: ${result.error}`);
    }

    return (result.data as Record<string, unknown>).images as {
      url: string;
      alt: string;
    }[];
  }

  /**
   * 分析图片（IImageGenerationPlugin 兼容接口）
   */
  async analyzeImage(params: {
    inputPath: string;
    action: string;
  }): Promise<Record<string, unknown>> {
    if (!this._imageAnalysisTool) {
      throw new Error('ImageAnalysisTool 未初始化');
    }

    const result = await this._imageAnalysisTool.execute(
      params,
      {} as ToolUseContext
    );
    if (!result.success) {
      throw new Error(`图片分析失败: ${result.error}`);
    }

    return result.data as Record<string, unknown>;
  }

  /**
   * 获取多媒体插件帮助信息
   */
  getHelpText(): string {
    return `MediaPlugin 支持以下功能:
  - generateImage: 使用 AI 生成图片
  - analyzeImage: 分析图片元数据、色彩、内容

使用 PluginAPI 注册为多媒体工具，可通过 tools 域访问。`;
  }
}

/**
 * 创建 MediaPlugin 实例
 */
export function createMediaPlugin(): MediaPlugin {
  return new MediaPlugin();
}
