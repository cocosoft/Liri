// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * MediaModule — Media 模块生命周期管理
 *
 * 在应用启动时注册 16 个 media 工具到 ToolManager。
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { globalToolManager } from '@modules/tools';
import { handleError } from '@modules/error';
import { createImageConvertTool } from './tools/ImageConvertTool';
import { createImageResizeTool } from './tools/ImageResizeTool';
import { createImageCropTool } from './tools/ImageCropTool';
import { createImageRotateTool } from './tools/ImageRotateTool';
import { createImageWatermarkTool } from './tools/ImageWatermarkTool';
import { createImageAdjustTool } from './tools/ImageAdjustTool';
import { createMediaInfoTool } from './tools/MediaInfoTool';
import { createMediaDeleteTool } from './tools/MediaDeleteTool';
import { createMediaDeleteBatchTool } from './tools/MediaDeleteBatchTool';
import { createVideoCompressTool } from './tools/VideoCompressTool';
import { createVideoExtractAudioTool } from './tools/VideoExtractAudioTool';
import { createVideoExtractThumbnailTool } from './tools/VideoExtractThumbnailTool';
import { createQRGenerateTool } from './tools/QRGenerateTool';
import { createQRDecodeTool } from './tools/QRDecodeTool';
import { createPdfExtractTool } from './tools/PdfExtractTool';

const logger = new Logger({ module: 'media:module', level: LogLevel.INFO });

export enum MediaModuleStatus {
  UNINITIALIZED = 'uninitialized',
  READY = 'ready',
  DEGRADED = 'degraded',
  SHUTDOWN = 'shutdown',
}

export class MediaModule {
  private status: MediaModuleStatus = MediaModuleStatus.UNINITIALIZED;

  async onLoad(): Promise<void> {
    logger.info('MediaModule loading...');
  }

  async onReady(): Promise<void> {
    try {
      // 图像工具（6）
      globalToolManager.registerTool(createImageConvertTool());
      globalToolManager.registerTool(createImageResizeTool());
      globalToolManager.registerTool(createImageCropTool());
      globalToolManager.registerTool(createImageRotateTool());
      globalToolManager.registerTool(createImageWatermarkTool());
      globalToolManager.registerTool(createImageAdjustTool());

      // 信息工具（1）
      globalToolManager.registerTool(createMediaInfoTool());

      // 删除工具（2，含 Inbox 审批）
      globalToolManager.registerTool(createMediaDeleteTool());
      globalToolManager.registerTool(createMediaDeleteBatchTool());

      // 视频工具（3）
      globalToolManager.registerTool(createVideoCompressTool());
      globalToolManager.registerTool(createVideoExtractAudioTool());
      globalToolManager.registerTool(createVideoExtractThumbnailTool());

      // QR 工具（2）
      globalToolManager.registerTool(createQRGenerateTool());
      globalToolManager.registerTool(createQRDecodeTool());

      // PDF 工具（1）
      globalToolManager.registerTool(createPdfExtractTool());

      this.status = MediaModuleStatus.READY;
      logger.info('MediaModule ready — 15 media tools registered');
    } catch (err) {
      await handleError(err, { module: 'media:module', action: 'onReady' });
      this.status = MediaModuleStatus.DEGRADED;
      logger.warn('MediaModule degraded — tool registration failed', {
        error: String(err),
      });
    }
  }

  async onDestroy(): Promise<void> {
    logger.info('MediaModule shutting down...');
    this.status = MediaModuleStatus.SHUTDOWN;
  }

  getStatus(): MediaModuleStatus {
    return this.status;
  }

  getCapabilities() {
    return {
      status: this.status,
      toolCount: 15,
    };
  }
}
