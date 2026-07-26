// MIT License
// Copyright (c) 2026 190615273@qq.com

import type { Tool, ToolParam, ToolInfo } from '../../tools/types/Tool';
import { ToolExecutionStatus } from '../../tools/types/ToolResult';
import type { ToolUseContext } from '../../tools/types/ToolUseContext';
import { resolveSafePath } from './MediaPathGuard';
import { MediaErrorCode, MEDIA_ERROR_MESSAGES } from './MediaErrorCodes';
import type { MediaToolResult } from './MediaToolResult';
import { imageProcessor } from '../image/ImageProcessor';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({ module: 'media:tool:crop', level: LogLevel.INFO });

export function createImageCropTool(): Tool {
  return {
    name: 'media:image:crop',
    description: 'Crop image to a rectangular region',
    params: [
      {
        name: 'input',
        type: 'string',
        description: 'Input image path',
        required: true,
      },
      {
        name: 'output',
        type: 'string',
        description: 'Output image path',
        required: true,
      },
      {
        name: 'x',
        type: 'number',
        description: 'Crop region left offset (pixels)',
        required: true,
      },
      {
        name: 'y',
        type: 'number',
        description: 'Crop region top offset (pixels)',
        required: true,
      },
      {
        name: 'width',
        type: 'number',
        description: 'Crop region width (pixels)',
        required: true,
      },
      {
        name: 'height',
        type: 'number',
        description: 'Crop region height (pixels)',
        required: true,
      },
    ],
    aliases: ['img_crop', 'image_crop'],
    searchTips: ['image', 'crop', 'cut', 'region'],
    isEnabled: () => true,
    isReadOnly: () => false,
    isDestructive: () => false,
    isConcurrencySafe: () => true,

    async execute(
      input: Record<string, unknown>,
      _context: ToolUseContext
    ): Promise<MediaToolResult> {
      const startTime = Date.now();
      const inPath = input.input as string;
      const outPath = input.output as string;

      const safeInput = resolveSafePath(inPath);
      if (!safeInput.valid) {
        return {
          status: ToolExecutionStatus.FAILURE,
          error: safeInput.error,
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: safeInput.error!,
          progress: [],
          metadata: { errorCode: MediaErrorCode.PATH_INSECURE },
          executionId: `img_crop_${Date.now()}`,
          toolName: 'media:image:crop',
          timestamp: Date.now(),
        };
      }
      const safeOutput = resolveSafePath(outPath);
      if (!safeOutput.valid) {
        return {
          status: ToolExecutionStatus.FAILURE,
          error: safeOutput.error,
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: safeOutput.error!,
          progress: [],
          metadata: { errorCode: MediaErrorCode.PATH_INSECURE },
          executionId: `img_crop_${Date.now()}`,
          toolName: 'media:image:crop',
          timestamp: Date.now(),
        };
      }

      try {
        const options = {
          x: input.x as number,
          y: input.y as number,
          width: input.width as number,
          height: input.height as number,
        };

        const result = await imageProcessor.crop(
          safeInput.path!,
          safeOutput.path!,
          options
        );
        if (!result.success) {
          return {
            status: ToolExecutionStatus.FAILURE,
            error: result.error || 'Crop failed',
            executionTime: Date.now() - startTime,
            output: '',
            errorOutput: result.error || '',
            progress: [],
            metadata: { errorCode: MediaErrorCode.PROCESS_FAILED },
            executionId: `img_crop_${Date.now()}`,
            toolName: 'media:image:crop',
            timestamp: Date.now(),
          };
        }

        logger.info('Image cropped', {
          input: safeInput.path,
          output: safeOutput.path,
          options,
        });
        return {
          status: ToolExecutionStatus.SUCCESS,
          result,
          output: JSON.stringify(result),
          errorOutput: '',
          progress: [],
          metadata: {
            inputPath: safeInput.path,
            outputPath: safeOutput.path,
            ...options,
          },
          executionTime: Date.now() - startTime,
          outputPath: safeOutput.path,
          outputSize: result.processedSize,
          executionId: `img_crop_${Date.now()}`,
          toolName: 'media:image:crop',
          timestamp: Date.now(),
          content: `图片已裁剪: ${safeOutput.path}`,
        };
      } catch (err) {
        await handleError(err, {
          module: 'media:tool:crop',
          action: 'execute',
          context: { input: safeInput.path },
        });
        return {
          status: ToolExecutionStatus.FAILURE,
          error: err instanceof Error ? err.message : String(err),
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: String(err),
          progress: [],
          metadata: { errorCode: MediaErrorCode.PROCESS_FAILED },
          executionId: `img_crop_${Date.now()}`,
          toolName: 'media:image:crop',
          timestamp: Date.now(),
        };
      }
    },

    getInfo(): ToolInfo {
      return {
        name: 'media:image:crop',
        description: 'Crop image to a rectangular region',
        params: [
          {
            name: 'input',
            type: 'string',
            description: 'Input image path',
            required: true,
          },
          {
            name: 'output',
            type: 'string',
            description: 'Output image path',
            required: true,
          },
          {
            name: 'x',
            type: 'number',
            description: 'Crop region left offset (pixels)',
            required: true,
          },
          {
            name: 'y',
            type: 'number',
            description: 'Crop region top offset (pixels)',
            required: true,
          },
          {
            name: 'width',
            type: 'number',
            description: 'Crop region width (pixels)',
            required: true,
          },
          {
            name: 'height',
            type: 'number',
            description: 'Crop region height (pixels)',
            required: true,
          },
        ],
        aliases: ['img_crop'],
        searchTips: ['image', 'crop'],
        enabled: true,
        readOnly: false,
        destructive: false,
        concurrencySafe: true,
        deferred: false,
        alwaysLoad: false,
        interruptBehavior: 'block',
      };
    },
  };
}
