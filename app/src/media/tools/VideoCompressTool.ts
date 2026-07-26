// MIT License
// Copyright (c) 2026 190615273@qq.com

import type { Tool, ToolParam, ToolInfo } from '../../tools/types/Tool';
import { ToolExecutionStatus } from '../../tools/types/ToolResult';
import type { ToolUseContext } from '../../tools/types/ToolUseContext';
import { resolveSafePath } from './MediaPathGuard';
import { MediaErrorCode, MEDIA_ERROR_MESSAGES } from './MediaErrorCodes';
import type { MediaToolResult } from './MediaToolResult';
import { videoProcessor } from '../video/VideoProcessor';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import fs from 'fs';

const logger = new Logger({
  module: 'media:tool:compress',
  level: LogLevel.INFO,
});

export function createVideoCompressTool(): Tool {
  return {
    name: 'media:video:compress',
    description: 'Compress video with quality and resolution options',
    params: [
      {
        name: 'input',
        type: 'string',
        description: 'Input video path',
        required: true,
      },
      {
        name: 'output',
        type: 'string',
        description: 'Output video path',
        required: true,
      },
      {
        name: 'quality',
        type: 'number',
        description: 'Quality (0-100)',
        required: false,
      },
      {
        name: 'maxWidth',
        type: 'number',
        description: 'Max width in pixels',
        required: false,
      },
      {
        name: 'maxHeight',
        type: 'number',
        description: 'Max height in pixels',
        required: false,
      },
    ],
    aliases: ['video_compress'],
    searchTips: ['video', 'compress'],
    isEnabled: () => true,
    isReadOnly: () => false,
    isDestructive: () => false,
    isConcurrencySafe: () => false,

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
          executionId: `vid_compress_${Date.now()}`,
          toolName: 'media:video:compress',
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
          executionId: `vid_compress_${Date.now()}`,
          toolName: 'media:video:compress',
          timestamp: Date.now(),
        };
      }

      if (!fs.existsSync(safeInput.path!)) {
        return {
          status: ToolExecutionStatus.FAILURE,
          error: MEDIA_ERROR_MESSAGES[MediaErrorCode.FILE_NOT_FOUND],
          executionTime: Date.now() - startTime,
          output: '',
          errorOutput: MEDIA_ERROR_MESSAGES[MediaErrorCode.FILE_NOT_FOUND],
          progress: [],
          metadata: { errorCode: MediaErrorCode.FILE_NOT_FOUND },
          executionId: `vid_compress_${Date.now()}`,
          toolName: 'media:video:compress',
          timestamp: Date.now(),
        };
      }

      try {
        const options: Record<string, unknown> = {};
        if (input.quality !== undefined)
          options.quality = input.quality as number;
        if (input.maxWidth !== undefined)
          options.maxWidth = input.maxWidth as number;
        if (input.maxHeight !== undefined)
          options.maxHeight = input.maxHeight as number;

        const success = await videoProcessor.compress(
          safeInput.path!,
          safeOutput.path!,
          options as any
        );
        if (!success) {
          return {
            status: ToolExecutionStatus.FAILURE,
            error: MEDIA_ERROR_MESSAGES[MediaErrorCode.FFMPEG_UNAVAILABLE],
            executionTime: Date.now() - startTime,
            output: '',
            errorOutput:
              MEDIA_ERROR_MESSAGES[MediaErrorCode.FFMPEG_UNAVAILABLE],
            progress: [],
            metadata: { errorCode: MediaErrorCode.FFMPEG_UNAVAILABLE },
            executionId: `vid_compress_${Date.now()}`,
            toolName: 'media:video:compress',
            timestamp: Date.now(),
          };
        }

        const outputSize = fs.existsSync(safeOutput.path!)
          ? fs.statSync(safeOutput.path!).size
          : 0;
        logger.info('Video compressed', {
          input: safeInput.path,
          output: safeOutput.path,
        });
        return {
          status: ToolExecutionStatus.SUCCESS,
          output: JSON.stringify({ outputPath: safeOutput.path, outputSize }),
          errorOutput: '',
          progress: [],
          metadata: { inputPath: safeInput.path, outputPath: safeOutput.path },
          executionTime: Date.now() - startTime,
          outputPath: safeOutput.path,
          outputSize,
          executionId: `vid_compress_${Date.now()}`,
          toolName: 'media:video:compress',
          timestamp: Date.now(),
          content: `视频已压缩: ${safeOutput.path}`,
        };
      } catch (err) {
        await handleError(err, {
          module: 'media:tool:compress',
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
          executionId: `vid_compress_${Date.now()}`,
          toolName: 'media:video:compress',
          timestamp: Date.now(),
        };
      }
    },

    getInfo(): ToolInfo {
      return {
        name: 'media:video:compress',
        description: 'Compress video with quality and resolution options',
        params: [
          {
            name: 'input',
            type: 'string',
            description: 'Input video path',
            required: true,
          },
          {
            name: 'output',
            type: 'string',
            description: 'Output video path',
            required: true,
          },
          {
            name: 'quality',
            type: 'number',
            description: 'Quality (0-100)',
            required: false,
          },
          {
            name: 'maxWidth',
            type: 'number',
            description: 'Max width in pixels',
            required: false,
          },
          {
            name: 'maxHeight',
            type: 'number',
            description: 'Max height in pixels',
            required: false,
          },
        ],
        aliases: ['video_compress'],
        searchTips: ['video', 'compress'],
        enabled: true,
        readOnly: false,
        destructive: false,
        concurrencySafe: false,
        deferred: false,
        alwaysLoad: false,
        interruptBehavior: 'block',
      };
    },
  };
}
