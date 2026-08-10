// MIT License
// Copyright (c) 2026 190615273@qq.com

import type { Tool, ToolParam, ToolInfo } from '../../tools/types/Tool';
import { ToolExecutionStatus } from '../../tools/types/ToolResult';
import type { ToolUseContext } from '../../tools/types/ToolUseContext';
import { resolveSafePath } from './MediaPathGuard';
import { MediaErrorCode, MEDIA_ERROR_MESSAGES } from './MediaErrorCodes';
import type { MediaToolResult } from './MediaToolResult';
import { imageProcessor } from '../image/ImageProcessor';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('media:tool:resize');

export function createImageResizeTool(): Tool {
  return {
    name: 'media:image:resize',
    description: 'Resize image to specified dimensions',
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
        name: 'maxWidth',
        type: 'number',
        description: 'Maximum width in pixels',
        required: false,
      },
      {
        name: 'maxHeight',
        type: 'number',
        description: 'Maximum height in pixels',
        required: false,
      },
      {
        name: 'format',
        type: 'string',
        description: 'Output format (png, jpeg, webp)',
        required: false,
      },
      {
        name: 'quality',
        type: 'number',
        description: 'Output quality 1-100',
        required: false,
      },
      {
        name: 'grayscale',
        type: 'boolean',
        description: 'Convert to grayscale',
        required: false,
      },
    ],
    aliases: ['img_resize', 'image_resize'],
    searchTips: ['image', 'resize', 'scale', 'dimensions'],
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
          executionId: `img_resize_${Date.now()}`,
          toolName: 'media:image:resize',
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
          executionId: `img_resize_${Date.now()}`,
          toolName: 'media:image:resize',
          timestamp: Date.now(),
        };
      }

      try {
        const options: Record<string, unknown> = {};
        if (input.maxWidth !== undefined) options.maxWidth = input.maxWidth;
        if (input.maxHeight !== undefined) options.maxHeight = input.maxHeight;
        if (input.format !== undefined) options.format = input.format;
        if (input.quality !== undefined) options.quality = input.quality;
        if (input.grayscale !== undefined) options.grayscale = input.grayscale;

        const result = await imageProcessor.resize(
          safeInput.path!,
          safeOutput.path!,
          options as Record<string, unknown>
        );
        if (!result.success) {
          return {
            status: ToolExecutionStatus.FAILURE,
            error: result.error || 'Resize failed',
            executionTime: Date.now() - startTime,
            output: '',
            errorOutput: result.error || '',
            progress: [],
            metadata: { errorCode: MediaErrorCode.PROCESS_FAILED },
            executionId: `img_resize_${Date.now()}`,
            toolName: 'media:image:resize',
            timestamp: Date.now(),
          };
        }

        logger.info('Image resized', {
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
          executionId: `img_resize_${Date.now()}`,
          toolName: 'media:image:resize',
          timestamp: Date.now(),
          content: `图片已调整大小: ${safeOutput.path}`,
        };
      } catch (err) {
        await handleError(err, {
          module: 'media:tool:resize',
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
          executionId: `img_resize_${Date.now()}`,
          toolName: 'media:image:resize',
          timestamp: Date.now(),
        };
      }
    },

    getInfo(): ToolInfo {
      return {
        name: 'media:image:resize',
        description: 'Resize image to specified dimensions',
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
            name: 'maxWidth',
            type: 'number',
            description: 'Maximum width in pixels',
            required: false,
          },
          {
            name: 'maxHeight',
            type: 'number',
            description: 'Maximum height in pixels',
            required: false,
          },
          {
            name: 'format',
            type: 'string',
            description: 'Output format',
            required: false,
          },
          {
            name: 'quality',
            type: 'number',
            description: 'Output quality 1-100',
            required: false,
          },
          {
            name: 'grayscale',
            type: 'boolean',
            description: 'Convert to grayscale',
            required: false,
          },
        ],
        aliases: ['img_resize'],
        searchTips: ['image', 'resize'],
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
