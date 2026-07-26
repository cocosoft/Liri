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

const logger = new Logger({ module: 'media:tool:watermark', level: LogLevel.INFO });

export function createImageWatermarkTool(): Tool {
  return {
    name: 'media:image:watermark',
    description: 'Add a text watermark to an image',
    params: [
      { name: 'input', type: 'string', description: 'Input image path', required: true },
      { name: 'output', type: 'string', description: 'Output image path', required: true },
      { name: 'text', type: 'string', description: 'Watermark text', required: true },
      { name: 'position', type: 'string', description: 'Watermark position (top-left, top-right, bottom-left, bottom-right, center)', required: false },
      { name: 'fontSize', type: 'number', description: 'Font size in pixels', required: false },
      { name: 'color', type: 'string', description: 'Font color (e.g. rgba(255,255,255,0.5))', required: false },
      { name: 'opacity', type: 'number', description: 'Text opacity 0-1', required: false },
    ],
    aliases: ['img_watermark', 'image_watermark'],
    searchTips: ['image', 'watermark', 'text', 'overlay'],
    isEnabled: () => true,
    isReadOnly: () => false,
    isDestructive: () => false,
    isConcurrencySafe: () => true,

    async execute(input: Record<string, unknown>, _context: ToolUseContext): Promise<MediaToolResult> {
      const startTime = Date.now();
      const inPath = input.input as string;
      const outPath = input.output as string;

      const safeInput = resolveSafePath(inPath);
      if (!safeInput.valid) {
        return {
          status: ToolExecutionStatus.FAILURE,
          error: safeInput.error,
          executionTime: Date.now() - startTime,
          output: '', errorOutput: safeInput.error!,
          progress: [], metadata: { errorCode: MediaErrorCode.PATH_INSECURE },
          executionId: `img_watermark_${Date.now()}`, toolName: 'media:image:watermark', timestamp: Date.now(),
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
          executionId: `img_watermark_${Date.now()}`, toolName: 'media:image:watermark', timestamp: Date.now(),
        };
      }

      try {
        const options: Record<string, unknown> = {
          text: input.text as string,
        };
        if (input.position !== undefined) options.position = input.position;
        if (input.fontSize !== undefined) options.fontSize = input.fontSize;
        if (input.color !== undefined) options.color = input.color;
        if (input.opacity !== undefined) options.opacity = input.opacity;

        const result = await imageProcessor.watermark(safeInput.path!, safeOutput.path!, options as any);
        if (!result.success) {
          return {
            status: ToolExecutionStatus.FAILURE,
            error: result.error || 'Watermark failed',
            executionTime: Date.now() - startTime,
            output: '', errorOutput: result.error || '',
            progress: [], metadata: { errorCode: MediaErrorCode.PROCESS_FAILED },
            executionId: `img_watermark_${Date.now()}`, toolName: 'media:image:watermark', timestamp: Date.now(),
          };
        }

        logger.info('Image watermarked', { input: safeInput.path, output: safeOutput.path, options });
        return {
          status: ToolExecutionStatus.SUCCESS,
          result,
          output: JSON.stringify(result),
          errorOutput: '', progress: [],
          metadata: { inputPath: safeInput.path, outputPath: safeOutput.path, ...options },
          executionTime: Date.now() - startTime,
          outputPath: safeOutput.path,
          outputSize: result.processedSize,
          executionId: `img_watermark_${Date.now()}`, toolName: 'media:image:watermark', timestamp: Date.now(),
          content: `图片已添加水印: ${safeOutput.path}`,
        };
      } catch (err) {
        await handleError(err, { module: 'media:tool:watermark', action: 'execute', context: { input: safeInput.path } });
        return {
          status: ToolExecutionStatus.FAILURE,
          error: err instanceof Error ? err.message : String(err),
          executionTime: Date.now() - startTime,
          output: '', errorOutput: String(err),
          progress: [], metadata: { errorCode: MediaErrorCode.PROCESS_FAILED },
          executionId: `img_watermark_${Date.now()}`, toolName: 'media:image:watermark', timestamp: Date.now(),
        };
      }
    },

    getInfo(): ToolInfo {
      return {
        name: 'media:image:watermark',
        description: 'Add a text watermark to an image',
        params: [
          { name: 'input', type: 'string', description: 'Input image path', required: true },
          { name: 'output', type: 'string', description: 'Output image path', required: true },
          { name: 'text', type: 'string', description: 'Watermark text', required: true },
          { name: 'position', type: 'string', description: 'Watermark position', required: false },
          { name: 'fontSize', type: 'number', description: 'Font size in pixels', required: false },
          { name: 'color', type: 'string', description: 'Font color', required: false },
          { name: 'opacity', type: 'number', description: 'Text opacity 0-1', required: false },
        ],
        aliases: ['img_watermark'],
        searchTips: ['image', 'watermark'],
        enabled: true, readOnly: false, destructive: false, concurrencySafe: true,
        deferred: false, alwaysLoad: false, interruptBehavior: 'block',
      };
    },
  };
}
