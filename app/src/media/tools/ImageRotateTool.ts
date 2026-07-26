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

const logger = new Logger({ module: 'media:tool:rotate', level: LogLevel.INFO });

export function createImageRotateTool(): Tool {
  return {
    name: 'media:image:rotate',
    description: 'Rotate image by specified degrees',
    params: [
      { name: 'input', type: 'string', description: 'Input image path', required: true },
      { name: 'output', type: 'string', description: 'Output image path', required: true },
      { name: 'degrees', type: 'number', description: 'Rotation angle in degrees (e.g. 90, 180, -45)', required: true },
    ],
    aliases: ['img_rotate', 'image_rotate'],
    searchTips: ['image', 'rotate', 'rotation', 'angle'],
    isEnabled: () => true,
    isReadOnly: () => false,
    isDestructive: () => false,
    isConcurrencySafe: () => true,

    async execute(input: Record<string, unknown>, _context: ToolUseContext): Promise<MediaToolResult> {
      const startTime = Date.now();
      const inPath = input.input as string;
      const outPath = input.output as string;
      const degrees = input.degrees as number;

      const safeInput = resolveSafePath(inPath);
      if (!safeInput.valid) {
        return {
          status: ToolExecutionStatus.FAILURE,
          error: safeInput.error,
          executionTime: Date.now() - startTime,
          output: '', errorOutput: safeInput.error!,
          progress: [], metadata: { errorCode: MediaErrorCode.PATH_INSECURE },
          executionId: `img_rotate_${Date.now()}`, toolName: 'media:image:rotate', timestamp: Date.now(),
        };
      }
      const safeOutput = resolveSafePath(outPath);
      if (!safeOutput.valid) {
        return {
          status: ToolExecutionStatus.FAILURE,
          error: safeOutput.error,
          executionTime: Date.now() - startTime,
          output: '', errorOutput: safeOutput.error!,
          progress: [], metadata: { errorCode: MediaErrorCode.PATH_INSECURE },
          executionId: `img_rotate_${Date.now()}`, toolName: 'media:image:rotate', timestamp: Date.now(),
        };
      }

      try {
        const result = await imageProcessor.rotate(safeInput.path!, safeOutput.path!, degrees);
        if (!result.success) {
          return {
            status: ToolExecutionStatus.FAILURE,
            error: result.error || 'Rotation failed',
            executionTime: Date.now() - startTime,
            output: '', errorOutput: result.error || '',
            progress: [], metadata: { errorCode: MediaErrorCode.PROCESS_FAILED },
            executionId: `img_rotate_${Date.now()}`, toolName: 'media:image:rotate', timestamp: Date.now(),
          };
        }

        logger.info('Image rotated', { input: safeInput.path, output: safeOutput.path, degrees });
        return {
          status: ToolExecutionStatus.SUCCESS,
          result,
          output: JSON.stringify(result),
          errorOutput: '', progress: [],
          metadata: { inputPath: safeInput.path, outputPath: safeOutput.path, degrees },
          executionTime: Date.now() - startTime,
          outputPath: safeOutput.path,
          outputSize: result.processedSize,
          executionId: `img_rotate_${Date.now()}`, toolName: 'media:image:rotate', timestamp: Date.now(),
          content: `图片已旋转 ${degrees}°: ${safeOutput.path}`,
        };
      } catch (err) {
        await handleError(err, { module: 'media:tool:rotate', action: 'execute', context: { input: safeInput.path, degrees } });
        return {
          status: ToolExecutionStatus.FAILURE,
          error: err instanceof Error ? err.message : String(err),
          executionTime: Date.now() - startTime,
          output: '', errorOutput: String(err),
          progress: [], metadata: { errorCode: MediaErrorCode.PROCESS_FAILED },
          executionId: `img_rotate_${Date.now()}`, toolName: 'media:image:rotate', timestamp: Date.now(),
        };
      }
    },

    getInfo(): ToolInfo {
      return {
        name: 'media:image:rotate',
        description: 'Rotate image by specified degrees',
        params: [
          { name: 'input', type: 'string', description: 'Input image path', required: true },
          { name: 'output', type: 'string', description: 'Output image path', required: true },
          { name: 'degrees', type: 'number', description: 'Rotation angle in degrees', required: true },
        ],
        aliases: ['img_rotate'],
        searchTips: ['image', 'rotate'],
        enabled: true, readOnly: false, destructive: false, concurrencySafe: true,
        deferred: false, alwaysLoad: false, interruptBehavior: 'block',
      };
    },
  };
}
