// MIT License
// Copyright (c) 2026 190615273@qq.com

import type { Tool, ToolParam, ToolInfo } from '../../tools/types/Tool';
import { ToolExecutionStatus } from '../../tools/types/ToolResult';
import type { ToolUseContext } from '../../tools/types/ToolUseContext';
import { resolveSafePath } from './MediaPathGuard';
import { MediaErrorCode, MEDIA_ERROR_MESSAGES } from './MediaErrorCodes';
import type { MediaToolResult } from './MediaToolResult';
import { imageProcessor } from '../image/ImageProcessor';
import type { ImageFormat } from '../image/ImageProcessor';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('media:tool:convert');

export function createImageConvertTool(): Tool {
  return {
    name: 'media:image:convert',
    description: 'Convert image format (e.g. PNG to JPEG, WebP to PNG)',
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
        name: 'format',
        type: 'string',
        description: 'Target format (png, jpeg, webp, gif, bmp)',
        required: true,
      },
    ],
    aliases: ['img_convert', 'image_convert'],
    searchTips: ['image', 'convert', 'format'],
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
      const format = input.format as string;

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
          executionId: `img_convert_${Date.now()}`,
          toolName: 'media:image:convert',
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
          executionId: `img_convert_${Date.now()}`,
          toolName: 'media:image:convert',
          timestamp: Date.now(),
        };
      }

      try {
        const result = await imageProcessor.convert(
          safeInput.path!,
          safeOutput.path!,
          format as ImageFormat
        );
        if (!result.success) {
          return {
            status: ToolExecutionStatus.FAILURE,
            error: result.error || 'Conversion failed',
            executionTime: Date.now() - startTime,
            output: '',
            errorOutput: result.error || '',
            progress: [],
            metadata: { errorCode: MediaErrorCode.PROCESS_FAILED },
            executionId: `img_convert_${Date.now()}`,
            toolName: 'media:image:convert',
            timestamp: Date.now(),
          };
        }

        logger.info('Image converted', {
          input: safeInput.path,
          output: safeOutput.path,
          format,
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
            format,
          },
          executionTime: Date.now() - startTime,
          outputPath: safeOutput.path,
          outputSize: result.processedSize,
          executionId: `img_convert_${Date.now()}`,
          toolName: 'media:image:convert',
          timestamp: Date.now(),
          content: `图片已转换为 ${format}: ${safeOutput.path}`,
        };
      } catch (err) {
        await handleError(err, {
          module: 'media:tool:convert',
          action: 'execute',
          context: { input: safeInput.path, format },
        });
        return {
          status: ToolExecutionStatus.FAILURE,
          error: err instanceof Error ? err.message : String(err),
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: String(err),
          progress: [],
          metadata: { errorCode: MediaErrorCode.PROCESS_FAILED },
          executionId: `img_convert_${Date.now()}`,
          toolName: 'media:image:convert',
          timestamp: Date.now(),
        };
      }
    },

    getInfo(): ToolInfo {
      return {
        name: 'media:image:convert',
        description: 'Convert image format',
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
            name: 'format',
            type: 'string',
            description: 'Target format',
            required: true,
          },
        ],
        aliases: ['img_convert'],
        searchTips: ['image', 'convert'],
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
