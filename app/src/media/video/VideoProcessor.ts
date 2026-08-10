/**
 * VideoProcessor 视频处理
 * 对标 OpenClaw 的视频处理能力
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = getLogger('media:video');

/**
 * 视频信息
 */
export interface VideoInfo {
  width: number;
  height: number;
  duration: number;
  format: string;
  codec: string;
  fileSize: number;
}

/**
 * 处理选项
 */
export interface VideoProcessOptions {
  outputFormat?: string;
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  startTime?: number;
  duration?: number;
}

/**
 * 视频处理器
 */
export class VideoProcessor {
  /**
   * 获取视频信息
   */
  async getInfo(filePath: string): Promise<VideoInfo | null> {
    try {
      if (!fs.existsSync(filePath)) return null;

      const stat = fs.statSync(filePath);

      return {
        width: 0,
        height: 0,
        duration: 0,
        format: path.extname(filePath).slice(1),
        codec: 'unknown',
        fileSize: stat.size,
      };
    } catch {
      void handleError(new Error('Failed to get video info'), {
        module: 'media:video',
        action: 'getInfo',
      });
      return null;
    }
  }

  /**
   * 压缩视频
   */
  async compress(
    inputPath: string,
    outputPath: string,
    options?: VideoProcessOptions
  ): Promise<boolean> {
    try {
      const args = ['-i', inputPath];

      if (options?.maxWidth) {
        args.push(
          '-vf',
          `scale='min(${options.maxWidth},iw)':'min(${options.maxHeight || options.maxWidth},ih)'`
        );
      }

      if (options?.quality !== undefined) {
        const crf = Math.round(51 - (options.quality / 100) * 51);
        args.push('-crf', String(crf));
      }

      if (options?.startTime !== undefined) {
        args.push('-ss', String(options.startTime));
      }

      if (options?.duration !== undefined) {
        args.push('-t', String(options.duration));
      }

      args.push('-y', outputPath);

      return await this.runFfmpeg(args);
    } catch {
      void handleError(new Error('Failed to compress video'), {
        module: 'media:video',
        action: 'compress',
      });
      return false;
    }
  }

  /**
   * 提取音频
   */
  async extractAudio(inputPath: string, outputPath: string): Promise<boolean> {
    try {
      const args = [
        '-i',
        inputPath,
        '-vn',
        '-acodec',
        'copy',
        '-y',
        outputPath,
      ];

      return await this.runFfmpeg(args);
    } catch {
      void handleError(new Error('Failed to extract audio'), {
        module: 'media:video',
        action: 'extractAudio',
      });
      return false;
    }
  }

  /**
   * 提取缩略图
   */
  async extractThumbnail(
    inputPath: string,
    outputPath: string,
    time: number = 1
  ): Promise<boolean> {
    try {
      const args = [
        '-i',
        inputPath,
        '-ss',
        String(time),
        '-vframes',
        '1',
        '-y',
        outputPath,
      ];

      return await this.runFfmpeg(args);
    } catch {
      void handleError(new Error('Failed to extract thumbnail'), {
        module: 'media:video',
        action: 'extractThumbnail',
      });
      return false;
    }
  }

  /**
   * 运行 ffmpeg
   */
  private async runFfmpeg(args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      const ffmpeg = spawn('ffmpeg', args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      ffmpeg.on('close', (code) => {
        resolve(code === 0);
      });

      ffmpeg.on('error', () => {
        resolve(false);
      });
    });
  }
}

export const videoProcessor = new VideoProcessor();
