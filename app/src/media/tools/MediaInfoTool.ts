// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * MediaInfoTool — 查询媒体文件元数据
 *
 * 统一查询图片/视频/音频/PDF 的元信息（尺寸、时长、格式等）。
 */

import type { Tool, ToolParam, ToolInfo } from '../../tools/types/Tool';
import { ToolExecutionStatus } from '../../tools/types/ToolResult';
import type { ToolUseContext } from '../../tools/types/ToolUseContext';
import { resolveSafePath } from './MediaPathGuard';
import { MediaErrorCode, MEDIA_ERROR_MESSAGES } from './MediaErrorCodes';
import type { MediaToolResult } from './MediaToolResult';
import { imageFormatDetector } from '../image/ImageFormatDetector';
import { mediaStore } from '../store/MediaStore';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({ module: 'media:tool:info', level: LogLevel.INFO });

export function createMediaInfoTool(): Tool {
  return {
    name: 'media:info',
    description:
      'Get metadata of a media file (image/video/audio/pdf). Returns dimensions, format, duration, file size etc.',
    params: [
      {
        name: 'filePath',
        type: 'string',
        description: 'Path to the media file',
        required: true,
      },
    ],
    aliases: ['media_info', 'file_info'],
    searchTips: ['media', 'info', 'metadata', 'dimensions', 'size'],
    isEnabled: () => true,
    isReadOnly: () => true,
    isDestructive: () => false,
    isConcurrencySafe: () => true,

    async execute(
      input: Record<string, unknown>,
      _context: ToolUseContext
    ): Promise<MediaToolResult> {
      const startTime = Date.now();
      const filePath = input.filePath as string;

      // 路径安全校验
      const safe = resolveSafePath(filePath);
      if (!safe.valid) {
        return {
          status: ToolExecutionStatus.FAILURE,
          error: safe.error,
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: safe.error!,
          progress: [],
          metadata: { errorCode: MediaErrorCode.PATH_INSECURE },
          executionId: `media_info_${Date.now()}`,
          toolName: 'media:info',
          timestamp: Date.now(),
        };
      }

      try {
        const info = mediaStore.getInfo(safe.path!);
        if (!info) {
          return {
            status: ToolExecutionStatus.FAILURE,
            error: MEDIA_ERROR_MESSAGES[MediaErrorCode.FILE_NOT_FOUND],
            executionTime: Date.now() - startTime,
            output: '',
            errorOutput: '',
            progress: [],
            metadata: { errorCode: MediaErrorCode.FILE_NOT_FOUND },
            executionId: `media_info_${Date.now()}`,
            toolName: 'media:info',
            timestamp: Date.now(),
          };
        }

        // 图像额外信息
        let dimensions: { width: number; height: number } | null = null;
        try {
          const dimResult = imageFormatDetector.detectDimensions(safe.path!);
          if (dimResult) {
            dimensions = { width: dimResult.width, height: dimResult.height };
          }
        } catch {
          // 非图像文件跳过尺寸检测
        }

        const metadata: Record<string, unknown> = {
          format: info.mimeType,
          fileSize: info.size,
          createdAt: info.createdAt,
        };
        if (dimensions) {
          metadata.dimensions = dimensions;
        }

        logger.info('Media info retrieved', {
          filePath: safe.path,
          ...metadata,
        });

        return {
          status: ToolExecutionStatus.SUCCESS,
          result: metadata,
          output: JSON.stringify(metadata),
          errorOutput: '',
          progress: [],
          metadata,
          executionTime: Date.now() - startTime,
          outputSize: info.size,
          executionId: `media_info_${Date.now()}`,
          toolName: 'media:info',
          timestamp: Date.now(),
          content: `文件信息: ${JSON.stringify(metadata)}`,
        };
      } catch (err) {
        await handleError(err, {
          module: 'media:tool:info',
          action: 'execute',
          context: { filePath: safe.path },
        });
        return {
          status: ToolExecutionStatus.FAILURE,
          error: err instanceof Error ? err.message : String(err),
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: String(err),
          progress: [],
          metadata: { errorCode: MediaErrorCode.PROCESS_FAILED },
          executionId: `media_info_${Date.now()}`,
          toolName: 'media:info',
          timestamp: Date.now(),
        };
      }
    },

    getInfo(): ToolInfo {
      return {
        name: 'media:info',
        description: 'Get metadata of a media file',
        params: [
          {
            name: 'filePath',
            type: 'string',
            description: 'Path to the media file',
            required: true,
          },
        ],
        aliases: ['media_info', 'file_info'],
        searchTips: ['media', 'info', 'metadata'],
        enabled: true,
        readOnly: true,
        destructive: false,
        concurrencySafe: true,
        deferred: false,
        alwaysLoad: false,
        interruptBehavior: 'block',
      };
    },
  };
}
