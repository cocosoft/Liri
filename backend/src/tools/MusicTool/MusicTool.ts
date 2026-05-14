/**
 * MusicTool
 * 通用音频/音乐编辑工具
 * 支持 convert / info / trim / volume 等编辑操作
 * 复用现有 media/ffmpeg/FFmpegWrapper.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';

import { FFmpegWrapper } from '../../media/ffmpeg/FFmpegWrapper';

/**
 * 音频编辑操作参数
 */
export interface MusicEditInput {
  action: 'convert' | 'info' | 'trim' | 'volume';
  inputPath: string;
  outputPath?: string;
  format?: string;
  startTime?: number;
  duration?: number;
  volume?: number;
  bitrate?: string;
}

/**
 * 音频编辑结果
 */
export interface MusicEditOutput {
  action: string;
  inputPath: string;
  outputPath?: string;
  originalSize?: number;
  processedSize?: number;
  duration?: number;
  format?: string;
  codec?: string;
  bitrate?: string;
}

const ffmpeg = new FFmpegWrapper();

export class MusicTool extends BaseTool {
  name = 'music';

  description = 'Edit and manipulate audio/music files. Supports format conversion, metadata info, trimming, and volume adjustment.';

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      enum: ['convert', 'info', 'trim', 'volume'],
      description: 'Audio editing action to perform',
      required: true,
    },
    {
      name: 'inputPath',
      type: 'string',
      description: 'Path to the input audio file',
      required: true,
    },
    {
      name: 'outputPath',
      type: 'string',
      description: 'Path for the output audio file',
      required: false,
    },
    {
      name: 'format',
      type: 'string',
      description: 'Target format (e.g., mp3, wav, flac, ogg, aac) for convert action',
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
      name: 'volume',
      type: 'number',
      description: 'Volume multiplier (e.g., 0.5 halves volume, 2.0 doubles) for volume action',
      required: false,
    },
    {
      name: 'bitrate',
      type: 'string',
      description: 'Target bitrate (e.g., 128k, 192k, 320k) for convert action',
      required: false,
    },
  ];

  async execute(input: any, _context: ToolUseContext): Promise<ToolResult> {
    try {
      const params = input as MusicEditInput;

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
        case 'convert':
          return this.handleConvert(params);
        case 'info':
          return this.handleInfo(params);
        case 'trim':
          return this.handleTrim(params);
        case 'volume':
          return this.handleVolume(params);
        default:
          return {
            success: false,
            error: `Unknown action: ${params.action}. Supported: convert, info, trim, volume`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `Audio operation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 转换音频格式
   */
  private async handleConvert(params: MusicEditInput): Promise<ToolResult> {
    if (!params.format) {
      return {
        success: false,
        error: 'Target format is required for convert action',
      };
    }

    const outputPath = params.outputPath || params.inputPath.replace(path.extname(params.inputPath), `.${params.format}`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const ffmpegArgs: string[] = [];
    if (params.bitrate) {
      ffmpegArgs.push('-b:a', params.bitrate);
    }

    const result = await ffmpeg.run({
      input: params.inputPath,
      output: outputPath,
      args: ffmpegArgs,
      timeout: 180000,
    });

    if (!result.success) {
      return {
        success: false,
        error: `Convert failed: ${result.stderr.substring(0, 500)}`,
      };
    }

    const outStat = fs.statSync(outputPath);
    const inStat = fs.statSync(params.inputPath);

    const data: MusicEditOutput = {
      action: 'convert',
      inputPath: params.inputPath,
      outputPath,
      originalSize: inStat.size,
      processedSize: outStat.size,
      format: params.format,
      bitrate: params.bitrate,
    };

    return {
      success: true,
      data,
      output: `Audio converted to ${params.format}: ${outputPath}`,
    };
  }

  /**
   * 获取音频信息
   */
  private async handleInfo(params: MusicEditInput): Promise<ToolResult> {
    const probing = await ffmpeg.probe(params.inputPath);

    if (!probing) {
      return {
        success: false,
        error: 'Failed to probe audio file',
      };
    }

    const audioStream = probing.streams.find(s => s.codec_type === 'audio');
    const size = probing.format.size;

    const data: MusicEditOutput = {
      action: 'info',
      inputPath: params.inputPath,
      originalSize: size,
      duration: probing.format.duration,
      format: path.extname(params.inputPath).slice(1) || 'unknown',
      codec: audioStream?.codec_name,
      bitrate: `${(probing.format.bit_rate / 1000).toFixed(0)}kbps`,
    };

    const lines = [
      `File: ${params.inputPath}`,
      `Size: ${(size / 1024 / 1024).toFixed(1)} MB`,
      `Duration: ${probing.format.duration.toFixed(1)}s`,
      `Codec: ${audioStream?.codec_name || 'unknown'}`,
      `Bitrate: ${data.bitrate}`,
    ];

    return {
      success: true,
      data,
      output: lines.join('\n'),
    };
  }

  /**
   * 裁剪音频片段
   */
  private async handleTrim(params: MusicEditInput): Promise<ToolResult> {
    if (params.startTime === undefined && params.duration === undefined) {
      return {
        success: false,
        error: 'At least one of startTime or duration is required for trim action',
      };
    }

    const ext = path.extname(params.inputPath);
    const outputPath = params.outputPath || params.inputPath.replace(ext, `_trimmed${ext}`);
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

    const data: MusicEditOutput = {
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
      output: `Audio trimmed: ${outputPath} (${(outStat.size / 1024 / 1024).toFixed(1)} MB)`,
    };
  }

  /**
   * 调整音量
   */
  private async handleVolume(params: MusicEditInput): Promise<ToolResult> {
    if (params.volume === undefined || params.volume < 0) {
      return {
        success: false,
        error: 'Volume multiplier is required and must be >= 0 for volume action',
      };
    }

    const ext = path.extname(params.inputPath);
    const outputPath = params.outputPath || params.inputPath.replace(ext, `_volume${ext}`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const ffmpegArgs = ['-af', `volume=${params.volume}`];
    const result = await ffmpeg.run({
      input: params.inputPath,
      output: outputPath,
      args: ffmpegArgs,
      timeout: 180000,
    });

    if (!result.success) {
      return {
        success: false,
        error: `Volume adjustment failed: ${result.stderr.substring(0, 500)}`,
      };
    }

    const outStat = fs.statSync(outputPath);
    const inStat = fs.statSync(params.inputPath);

    const pct = Math.round(params.volume * 100);

    const data: MusicEditOutput = {
      action: 'volume',
      inputPath: params.inputPath,
      outputPath,
      originalSize: inStat.size,
      processedSize: outStat.size,
    };

    return {
      success: true,
      data,
      output: `Volume adjusted to ${pct}%: ${outputPath}`,
    };
  }
}

/**
 * 创建 MusicTool 实例
 */
export function createMusicTool(): MusicTool {
  return new MusicTool();
}
