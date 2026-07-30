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

const logger = new Logger({
  module: 'media:tool:adjust',
  level: LogLevel.INFO,
});

export function createImageAdjustTool(): Tool {
  return {
    name: 'media:image:adjust',
    description: 'Adjust image brightness, contrast, saturation, and gamma',
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
        name: 'brightness',
        type: 'number',
        description: 'Brightness multiplier (1.0 = unchanged)',
        required: false,
      },
      {
        name: 'contrast',
        type: 'number',
        description: 'Contrast multiplier (1.0 = unchanged)',
        required: false,
      },
      {
        name: 'saturation',
        type: 'number',
        description: 'Saturation multiplier (1.0 = unchanged)',
        required: false,
      },
      {
        name: 'gamma',
        type: 'number',
        description: 'Gamma correction value (e.g. 2.2)',
        required: false,
      },
    ],
    aliases: ['img_adjust', 'image_adjust'],
    searchTips: ['image', 'adjust', 'brightness', 'contrast', 'saturation'],
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
          executionId: `img_adjust_${Date.now()}`,
          toolName: 'media:image:adjust',
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
          executionId: `img_adjust_${Date.now()}`,
          toolName: 'media:image:adjust',
          timestamp: Date.now(),
        };
      }

      try {
        const options: Record<string, unknown> = {};
        if (input.brightness !== undefined)
          options.brightness = input.brightness;
        if (input.contrast !== undefined) options.contrast = input.contrast;
        if (input.saturation !== undefined)
          options.saturation = input.saturation;
        if (input.gamma !== undefined) options.gamma = input.gamma;

        const result = await imageProcessor.adjust(
          safeInput.path!,
          safeOutput.path!,
          options as Record<string, unknown>
        );
        if (!result.success) {
          return {
            status: ToolExecutionStatus.FAILURE,
            error: result.error || 'Adjustment failed',
            executionTime: Date.now() - startTime,
            output: '',
            errorOutput: result.error || '',
            progress: [],
            metadata: { errorCode: MediaErrorCode.PROCESS_FAILED },
            executionId: `img_adjust_${Date.now()}`,
            toolName: 'media:image:adjust',
            timestamp: Date.now(),
          };
        }

        logger.info('Image adjusted', {
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
          executionId: `img_adjust_${Date.now()}`,
          toolName: 'media:image:adjust',
          timestamp: Date.now(),
          content: `图片已调整: ${safeOutput.path}`,
        };
      } catch (err) {
        await handleError(err, {
          module: 'media:tool:adjust',
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
          executionId: `img_adjust_${Date.now()}`,
          toolName: 'media:image:adjust',
          timestamp: Date.now(),
        };
      }
    },

    getInfo(): ToolInfo {
      return {
        name: 'media:image:adjust',
        description: 'Adjust image brightness, contrast, saturation, and gamma',
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
            name: 'brightness',
            type: 'number',
            description: 'Brightness multiplier',
            required: false,
          },
          {
            name: 'contrast',
            type: 'number',
            description: 'Contrast multiplier',
            required: false,
          },
          {
            name: 'saturation',
            type: 'number',
            description: 'Saturation multiplier',
            required: false,
          },
          {
            name: 'gamma',
            type: 'number',
            description: 'Gamma correction value',
            required: false,
          },
        ],
        aliases: ['img_adjust'],
        searchTips: ['image', 'adjust'],
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
