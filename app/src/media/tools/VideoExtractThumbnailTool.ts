// MIT License
// Copyright (c) 2026 190615273@qq.com

import type { Tool, ToolParam, ToolInfo } from '../../tools/types/Tool';
import { ToolExecutionStatus } from '../../tools/types/ToolResult';
import type { ToolUseContext } from '../../tools/types/ToolUseContext';
import { resolveSafePath } from './MediaPathGuard';
import { MediaErrorCode, MEDIA_ERROR_MESSAGES } from './MediaErrorCodes';
import type { MediaToolResult } from './MediaToolResult';
import { videoProcessor } from '../video/VideoProcessor';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import fs from 'fs';

const logger = getLogger('media:tool:extract-thumbnail');

export function createVideoExtractThumbnailTool(): Tool {
  return {
    name: 'media:video:extract-thumbnail',
    description: 'Extract a thumbnail image from video at specified time',
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
        description: 'Output image path',
        required: true,
      },
      {
        name: 'time',
        type: 'number',
        description: 'Time in seconds to capture thumbnail',
        required: false,
      },
    ],
    aliases: ['video_thumbnail', 'video_extract_thumbnail'],
    searchTips: ['video', 'thumbnail', 'snapshot'],
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
      const captureTime = (input.time as number) ?? 1;

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
          executionId: `vid_thumb_${Date.now()}`,
          toolName: 'media:video:extract-thumbnail',
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
          executionId: `vid_thumb_${Date.now()}`,
          toolName: 'media:video:extract-thumbnail',
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
          executionId: `vid_thumb_${Date.now()}`,
          toolName: 'media:video:extract-thumbnail',
          timestamp: Date.now(),
        };
      }

      try {
        const success = await videoProcessor.extractThumbnail(
          safeInput.path!,
          safeOutput.path!,
          captureTime
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
            executionId: `vid_thumb_${Date.now()}`,
            toolName: 'media:video:extract-thumbnail',
            timestamp: Date.now(),
          };
        }

        const outputSize = fs.existsSync(safeOutput.path!)
          ? fs.statSync(safeOutput.path!).size
          : 0;
        logger.info('Thumbnail extracted', {
          input: safeInput.path,
          output: safeOutput.path,
          time: captureTime,
        });
        return {
          status: ToolExecutionStatus.SUCCESS,
          output: JSON.stringify({ outputPath: safeOutput.path, outputSize }),
          errorOutput: '',
          progress: [],
          metadata: {
            inputPath: safeInput.path,
            outputPath: safeOutput.path,
            time: captureTime,
          },
          executionTime: Date.now() - startTime,
          outputPath: safeOutput.path,
          outputSize,
          executionId: `vid_thumb_${Date.now()}`,
          toolName: 'media:video:extract-thumbnail',
          timestamp: Date.now(),
          content: `缩略图已提取: ${safeOutput.path} (${captureTime}s)`,
        };
      } catch (err) {
        await handleError(err, {
          module: 'media:tool:extract-thumbnail',
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
          executionId: `vid_thumb_${Date.now()}`,
          toolName: 'media:video:extract-thumbnail',
          timestamp: Date.now(),
        };
      }
    },

    getInfo(): ToolInfo {
      return {
        name: 'media:video:extract-thumbnail',
        description: 'Extract a thumbnail image from video at specified time',
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
            description: 'Output image path',
            required: true,
          },
          {
            name: 'time',
            type: 'number',
            description: 'Time in seconds to capture thumbnail',
            required: false,
          },
        ],
        aliases: ['video_thumbnail'],
        searchTips: ['video', 'thumbnail', 'snapshot'],
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
