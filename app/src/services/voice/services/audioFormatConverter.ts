/**
 * AudioFormatConverter
 * 音频格式转换器
 *
 * 基于 ffmpeg 子进程实现音频格式互转（Opus/MP3/WAV/PCM）。
 * 自动检测系统 ffmpeg 可用性，并提供降级策略。
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, basename, extname, join } from 'path';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('services:voice:services:audioFormatConverter');

/**
 * 支持的音频格式
 */
export type AudioFormat = 'wav' | 'mp3' | 'opus' | 'pcm16';

/**
 * 转换选项
 */
export interface AudioConvertOptions {
  /** 输入文件路径 */
  inputPath: string;
  /** 输出文件路径（可选，不指定则自动生成） */
  outputPath?: string;
  /** 目标格式 */
  targetFormat: AudioFormat;
  /** 采样率（Hz），默认 16000 */
  sampleRate?: number;
  /** 声道数，默认 1（单声道） */
  channels?: number;
  /** 比特率（仅 mp3/opus 有效），默认 128k（mp3）或 64k（opus） */
  bitrate?: string;
}

/**
 * 转换结果
 */
export interface AudioConvertResult {
  /** 是否成功 */
  success: boolean;
  /** 输出文件路径 */
  outputPath?: string;
  /** 转换后的时长（秒） */
  durationSec?: number;
  /** 输出文件大小（字节） */
  fileSize?: number;
  /** 错误信息 */
  error?: string;
}

/**
 * 音频格式信息
 */
export interface AudioFormatInfo {
  /** 格式名称 */
  format: AudioFormat;
  /** 文件扩展名 */
  extension: string;
  /** ffmpeg 编码器名称 */
  encoder: string;
  /** MIME 类型 */
  mimeType: string;
  /** 默认比特率 */
  defaultBitrate: string;
}

/** 格式映射表 */
const FORMAT_MAP: Record<AudioFormat, AudioFormatInfo> = {
  wav: {
    format: 'wav',
    extension: '.wav',
    encoder: 'pcm_s16le',
    mimeType: 'audio/wav',
    defaultBitrate: '',
  },
  mp3: {
    format: 'mp3',
    extension: '.mp3',
    encoder: 'libmp3lame',
    mimeType: 'audio/mpeg',
    defaultBitrate: '128k',
  },
  opus: {
    format: 'opus',
    extension: '.opus',
    encoder: 'libopus',
    mimeType: 'audio/opus',
    defaultBitrate: '64k',
  },
  pcm16: {
    format: 'pcm16',
    extension: '.pcm',
    encoder: 'pcm_s16le',
    mimeType: 'audio/L16',
    defaultBitrate: '',
  },
};

/** ffmpeg 可用性缓存 */
let ffmpegAvailableCache: boolean | null = null;

/**
 * 检查 ffmpeg 是否可用
 *
 * @param customPath 自定义 ffmpeg 路径
 * @returns ffmpeg 是否可用
 */
export function isFFmpegAvailable(customPath?: string): boolean {
  if (ffmpegAvailableCache !== null && !customPath) {
    return ffmpegAvailableCache;
  }

  try {
    const cmd = customPath || 'ffmpeg';
    execSync(`"${cmd}" -version 2>nul || ${cmd} -version 2>/dev/null`, {
      stdio: 'ignore',
      timeout: 5000,
    });

    ffmpegAvailableCache = true;
    return true;
  } catch {
    ffmpegAvailableCache = false;
    return false;
  }
}

/**
 * 重置 ffmpeg 可用性缓存（主要用于测试）
 */
export function resetFFmpegCache(): void {
  ffmpegAvailableCache = null;
}

/**
 * 获取格式信息
 */
export function getFormatInfo(format: AudioFormat): AudioFormatInfo {
  return FORMAT_MAP[format];
}

/**
 * 音频格式转换器
 */
export class AudioFormatConverter {
  /**
   * 转换音频格式
   *
   * @param options 转换选项
   * @returns 转换结果
   */
  static convert(options: AudioConvertOptions): AudioConvertResult {
    if (!existsSync(options.inputPath)) {
      return {
        success: false,
        error: `输入文件不存在: ${options.inputPath}`,
      };
    }

    if (!isFFmpegAvailable()) {
      return {
        success: false,
        error:
          'ffmpeg 不可用，无法进行音频格式转换。请安装 ffmpeg 并确保在 PATH 中',
      };
    }

    const meta = FORMAT_MAP[options.targetFormat];

    try {
      const sampleRate = options.sampleRate ?? 16000;
      const channels = options.channels ?? 1;

      const outputPath =
        options.outputPath ||
        this.generateOutputPath(options.inputPath, meta.extension);

      const args: string[] = [
        '-y',
        '-i',
        `"${options.inputPath}"`,
        '-ar',
        String(sampleRate),
        '-ac',
        String(channels),
      ];

      if (meta.format === 'mp3' || meta.format === 'opus') {
        const bitrate = options.bitrate || meta.defaultBitrate;
        args.push('-b:a', bitrate);
      }

      if (meta.format === 'pcm16') {
        args.push('-f', 's16le');
      }

      args.push(`"${outputPath}"`);

      const cmd = `ffmpeg ${args.join(' ')}`;
      execSync(cmd, { stdio: 'ignore', timeout: 60000 });

      return {
        success: true,
        outputPath,
      };
    } catch (error) {
      return {
        success: false,
        error: `音频转换失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 将音频文件转换为 WAV 格式
   *
   * @param inputPath 输入文件路径
   * @param outputPath 输出文件路径（可选）
   * @returns 转换结果
   */
  static toWav(inputPath: string, outputPath?: string): AudioConvertResult {
    return AudioFormatConverter.convert({
      inputPath,
      outputPath,
      targetFormat: 'wav',
    });
  }

  /**
   * 将音频文件转换为 MP3 格式
   *
   * @param inputPath 输入文件路径
   * @param outputPath 输出文件路径（可选）
   * @param bitrate 比特率（可选）
   * @returns 转换结果
   */
  static toMp3(
    inputPath: string,
    outputPath?: string,
    bitrate?: string
  ): AudioConvertResult {
    return AudioFormatConverter.convert({
      inputPath,
      outputPath,
      targetFormat: 'mp3',
      bitrate,
    });
  }

  /**
   * 将音频文件转换为 Opus 格式
   *
   * @param inputPath 输入文件路径
   * @param outputPath 输出文件路径（可选）
   * @param bitrate 比特率（可选）
   * @returns 转换结果
   */
  static toOpus(
    inputPath: string,
    outputPath?: string,
    bitrate?: string
  ): AudioConvertResult {
    return AudioFormatConverter.convert({
      inputPath,
      outputPath,
      targetFormat: 'opus',
      bitrate,
    });
  }

  /**
   * 将音频文件转换为 PCM16 原始格式
   *
   * @param inputPath 输入文件路径
   * @param outputPath 输出文件路径（可选）
   * @returns 转换结果
   */
  static toPCM16(inputPath: string, outputPath?: string): AudioConvertResult {
    return AudioFormatConverter.convert({
      inputPath,
      outputPath,
      targetFormat: 'pcm16',
    });
  }

  /**
   * 自动选择目标格式
   *
   * 根据平台和用途选择合适的音频格式：
   *   - Windows: WAV（兼容性最好）
   *   - macOS/Linux: MP3 或 Opus（压缩率高）
   *
   * @param forStreaming 是否用于流式传输
   * @returns 推荐的目标格式
   */
  static suggestFormat(forStreaming: boolean = false): AudioFormat {
    if (forStreaming) {
      return 'opus';
    }

    if (process.platform === 'win32') {
      return 'wav';
    }

    return 'mp3';
  }

  /**
   * 生成输出文件路径
   */
  private static generateOutputPath(
    inputPath: string,
    extension: string
  ): string {
    const dir = dirname(inputPath);
    const base = basename(inputPath, extname(inputPath));
    return join(dir, `${base}_converted${extension}`);
  }
}
