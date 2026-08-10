/**
 * VideoTool
 * 通用视频编辑工具
 * 支持 trim / compress / extract-audio / convert / info 等编辑操作
 * 复用现有 media/video/VideoProcessor.ts 和 media/ffmpeg/FFmpegWrapper.ts
 */

import * as fs from 'fs';
import * as path from 'path';

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';

import { VideoProcessor } from '../../media/video/VideoProcessor';
import { FFmpegWrapper } from '../../media/ffmpeg/FFmpegWrapper';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:VideoTool:VideoTool');

/**
 * 视频编辑操作参数
 */
export interface VideoEditInput {
  action: 'trim' | 'compress' | 'extract-audio' | 'convert' | 'info';
  inputPath: string;
  outputPath?: string;
  startTime?: number;
  duration?: number;
  format?: string;
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
}

/**
 * 视频编辑结果
 */
export interface VideoEditOutput {
  action: string;
  inputPath: string;
  outputPath?: string;
  originalSize?: number;
  processedSize?: number;
  duration?: number;
  width?: number;
  height?: number;
  format?: string;
  codec?: string;
}

const videoProcessor = new VideoProcessor();
const ffmpeg = new FFmpegWrapper();

export class VideoTool extends BaseTool {
  name = 'video';

  description =
    'Edit and manipulate videos. Supports trim, compress, extract audio, format conversion, and metadata info.';

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      enum: ['trim', 'compress', 'extract-audio', 'convert', 'info'],
      description: 'Video editing action to perform',
      required: true,
    },
    {
      name: 'inputPath',
      type: 'string',
      description: 'Path to the input video file',
      required: true,
    },
    {
      name: 'outputPath',
      type: 'string',
      description: 'Path for the output video file',
      required: false,
    },
    {
      name: 'startTime',
      type: 'number',
      description: 'Start time in seconds for trim action',
      required: false,
    },
    {
      name: 'duration',
      type: 'number',
      description: 'Duration in seconds for trim action',
      required: false,
    },
    {
      name: 'format',
      type: 'string',
      description: 'Target format (e.g., mp4, webm, avi) for convert action',
      required: false,
    },
    {
      name: 'quality',
      type: 'number',
      description: 'Output quality (1-100) for compress action',
      required: false,
    },
    {
      name: 'maxWidth',
      type: 'number',
      description: 'Maximum width for compress/resize',
      required: false,
    },
    {
      name: 'maxHeight',
      type: 'number',
      description: 'Maximum height for compress/resize',
      required: false,
    },
  ];

  async execute(input: any, _context: ToolUseContext): Promise<ToolResult> {
    try {
      const params = input as VideoEditInput;

      if (!params.inputPath) {
        return {
          success: false,
          error: 'inputPath is required',
        };
      }

      if (!fs.existsSync(params.inputPath)) {
        return {
          success: false,
          error: `Input file not found: ${params.inputPath}`,
        };
      }

      switch (params.action) {
        case 'trim':
          return this.handleTrim(params);
        case 'compress':
          return this.handleCompress(params);
        case 'extract-audio':
          return this.handleExtractAudio(params);
        case 'convert':
          return this.handleConvert(params);
        case 'info':
          return this.handleInfo(params);
        default:
          return {
            success: false,
            error: `Unknown action: ${params.action}. Supported: trim, compress, extract-audio, convert, info`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `Video operation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 裁剪视频片段
   */
  private async handleTrim(params: VideoEditInput): Promise<ToolResult> {
    if (params.startTime === undefined && params.duration === undefined) {
      return {
        success: false,
        error:
          'At least one of startTime or duration is required for trim action',
      };
    }

    const ext = path.extname(params.inputPath);
    const outputPath =
      params.outputPath || params.inputPath.replace(ext, `_trimmed${ext}`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const ffmpegArgs: string[] = [];
    if (params.startTime !== undefined) {
      ffmpegArgs.push('-ss', String(params.startTime));
    }
    if (params.duration !== undefined) {
      ffmpegArgs.push('-t', String(params.duration));
    }
    ffmpegArgs.push('-c', 'copy');

    const result = await ffmpeg.run({
      input: params.inputPath,
      output: outputPath,
      args: ffmpegArgs,
      timeout: 120000,
    });

    if (!result.success) {
      return {
        success: false,
        error: `Trim failed: ${result.stderr.substring(0, 500)}`,
      };
    }

    const outStat = fs.statSync(outputPath);
    const inStat = fs.statSync(params.inputPath);

    const data: VideoEditOutput = {
      action: 'trim',
      inputPath: params.inputPath,
      outputPath,
      originalSize: inStat.size,
      processedSize: outStat.size,
      duration: params.duration,
    };

    return {
      success: true,
      data,
      output: `Video trimmed: ${outputPath} (${(outStat.size / 1024 / 1024).toFixed(1)} MB)`,
    };
  }

  /**
   * 压缩视频
   */
  private async handleCompress(params: VideoEditInput): Promise<ToolResult> {
    const ext = path.extname(params.inputPath);
    const outputPath =
      params.outputPath || params.inputPath.replace(ext, `_compressed${ext}`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const success = await videoProcessor.compress(
      params.inputPath,
      outputPath,
      {
        maxWidth: params.maxWidth,
        maxHeight: params.maxHeight,
        quality: params.quality,
      }
    );

    if (!success) {
      return {
        success: false,
        error: 'Compression failed',
      };
    }

    const outStat = fs.statSync(outputPath);
    const inStat = fs.statSync(params.inputPath);

    const data: VideoEditOutput = {
      action: 'compress',
      inputPath: params.inputPath,
      outputPath,
      originalSize: inStat.size,
      processedSize: outStat.size,
    };

    return {
      success: true,
      data,
      output: `Video compressed: ${outputPath} (${(outStat.size / 1024 / 1024).toFixed(1)} MB, was ${(inStat.size / 1024 / 1024).toFixed(1)} MB)`,
    };
  }

  /**
   * 提取音频
   */
  private async handleExtractAudio(
    params: VideoEditInput
  ): Promise<ToolResult> {
    const outputPath =
      params.outputPath ||
      params.inputPath.replace(path.extname(params.inputPath), '.mp3');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const success = await videoProcessor.extractAudio(
      params.inputPath,
      outputPath
    );

    if (!success) {
      return {
        success: false,
        error: 'Audio extraction failed',
      };
    }

    const outStat = fs.statSync(outputPath);
    const inStat = fs.statSync(params.inputPath);

    const data: VideoEditOutput = {
      action: 'extract-audio',
      inputPath: params.inputPath,
      outputPath,
      originalSize: inStat.size,
      processedSize: outStat.size,
    };

    return {
      success: true,
      data,
      output: `Audio extracted: ${outputPath} (${(outStat.size / 1024 / 1024).toFixed(1)} MB)`,
    };
  }

  /**
   * 转换视频格式
   */
  private async handleConvert(params: VideoEditInput): Promise<ToolResult> {
    if (!params.format) {
      return {
        success: false,
        error: 'Target format is required for convert action',
      };
    }

    const outputPath =
      params.outputPath ||
      params.inputPath.replace(
        path.extname(params.inputPath),
        `.${params.format}`
      );
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const probing = await ffmpeg.probe(params.inputPath);
    if (!probing) {
      return {
        success: false,
        error: 'Failed to probe input video',
      };
    }

    const result = await ffmpeg.run({
      input: params.inputPath,
      output: outputPath,
      args: [],
      timeout: 300000,
    });

    if (!result.success) {
      return {
        success: false,
        error: `Convert failed: ${result.stderr.substring(0, 500)}`,
      };
    }

    const outStat = fs.statSync(outputPath);
    const inStat = fs.statSync(params.inputPath);

    const data: VideoEditOutput = {
      action: 'convert',
      inputPath: params.inputPath,
      outputPath,
      originalSize: inStat.size,
      processedSize: outStat.size,
      format: params.format,
    };

    return {
      success: true,
      data,
      output: `Video converted to ${params.format}: ${outputPath}`,
    };
  }

  /**
   * 获取视频信息
   */
  private async handleInfo(params: VideoEditInput): Promise<ToolResult> {
    const info = await videoProcessor.getInfo(params.inputPath);

    if (!info) {
      return {
        success: false,
        error: 'Failed to get video info',
      };
    }

    const data: VideoEditOutput = {
      action: 'info',
      inputPath: params.inputPath,
      originalSize: info.fileSize,
      duration: info.duration,
      width: info.width,
      height: info.height,
      format: info.format,
      codec: info.codec,
    };

    const lines = [
      `File: ${params.inputPath}`,
      `Size: ${(info.fileSize / 1024 / 1024).toFixed(1)} MB`,
      `Duration: ${info.duration}s`,
      `Resolution: ${info.width}x${info.height}`,
      `Format: ${info.format}`,
      `Codec: ${info.codec}`,
    ];

    return {
      success: true,
      data,
      output: lines.join('\n'),
    };
  }
}

/**
 * 创建 VideoTool 实例
 */
export function createVideoTool(): VideoTool {
  return new VideoTool();
}
