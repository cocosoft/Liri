/**
 * VideoProcessor 视频处理
 * 对标 OpenClaw 的视频处理能力
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import { ffmpegWrapper } from '../ffmpeg/FFmpegWrapper';

const logger = getLogger('media:video');

/** ffmpeg 单次调用超时上限（长视频压缩可能耗时，给 10 分钟上限防挂死） */
const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000;

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
   *
   * P2 补充（媒体排查导出笔记）：原实现为 stub（width/height/duration 恒 0、
   * codec 'unknown'），media:info 工具向 LLM/用户展示假数据。
   * 改为 ffprobe 探测真实元信息；ffprobe 不可用时降级为仅基础信息（大小/格式）。
   */
  async getInfo(filePath: string): Promise<VideoInfo | null> {
    try {
      if (!fs.existsSync(filePath)) return null;

      const stat = fs.statSync(filePath);
      const info: VideoInfo = {
        width: 0,
        height: 0,
        duration: 0,
        format: path.extname(filePath).slice(1),
        codec: 'unknown',
        fileSize: stat.size,
      };

      try {
        const probe = await ffmpegWrapper.probe(filePath);
        const videoStream = probe?.streams?.find(
          (s) => s.codec_type === 'video'
        );
        const audioStream = probe?.streams?.find(
          (s) => s.codec_type === 'audio'
        );
        const rawDuration = probe?.format?.duration ?? videoStream?.duration;
        info.width = videoStream?.width ?? 0;
        info.height = videoStream?.height ?? 0;
        if (rawDuration != null && Number.isFinite(rawDuration)) {
          info.duration = rawDuration;
        }
        info.codec =
          videoStream?.codec_name ?? audioStream?.codec_name ?? 'unknown';
      } catch {
        // ffprobe 不可用/解析失败：保留基础信息，时长/尺寸降级 0
      }

      return info;
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
      // BUG-3 修复：-acodec copy 仅做容器级转封装，不能把视频音频转为 WAV。
      // 转码为 16kHz 单声道 PCM（语音识别/ASR 的常用输入格式），否则 ffmpeg 必然失败。
      const args = [
        '-i',
        inputPath,
        '-vn',
        '-acodec',
        'pcm_s16le',
        '-ar',
        '16000',
        '-ac',
        '1',
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

      // BUG-8 修复：stderr 必须持续消费，否则管道缓冲区写满后 ffmpeg 会阻塞死锁。
      ffmpeg.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text) logger.debug(`ffmpeg: ${text}`);
      });

      // 超时保护：ffmpeg 挂死后强制 kill，防止 HTTP 请求永久挂起
      const timer = setTimeout(() => {
        logger.warn(`ffmpeg 超时（>${FFMPEG_TIMEOUT_MS}ms），强制终止`);
        ffmpeg.kill('SIGKILL');
      }, FFMPEG_TIMEOUT_MS);

      ffmpeg.on('close', (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });

      ffmpeg.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  }
}

export const videoProcessor = new VideoProcessor();
