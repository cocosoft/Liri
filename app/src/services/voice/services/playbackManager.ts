/**
 * PlaybackManager — 音频播放管理器（方案 B）
 *
 * 从 VoiceService 剥离的独立播放管理层，负责：
 * - PCMAudioPlayer 实例管理与生命周期
 * - 音频格式转换（WAV 头剥离 / ffmpeg PCM 转换）
 * - 播放事件发射
 *
 * 职责单一，不涉及 TTS 合成逻辑或队列管理。
 *
 * @example
 *   const pm = new PlaybackManager({ sampleRate: 16000, channels: 1, bitsPerSample: 16 });
 *   pm.onEvent = (event, data) => console.log(event, data);
 *   await pm.play(audioBuffer, 'wav');
 *   pm.destroy();
 */

import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Logger, getOTelTracing } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { PCMAudioPlayer } from './audioPlayer';
import {
  AudioFormatConverter,
  isFFmpegAvailable,
} from './audioFormatConverter';

const logger = new Logger({});

/** PlaybackManager 配置 */
export interface PlaybackConfig {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

/** 播放事件回调类型 */
export type PlaybackEventCallback = (
  event: string,
  data: Record<string, unknown>
) => void;

/** WAV 文件头固定大小 */
const WAV_HEADER_SIZE = 44;

/**
 * PlaybackManager — 音频播放管理器
 *
 * 封装 PCMAudioPlayer 的完整生命周期，
 * 提供音频格式自动转换和标准化播放接口。
 */
export class PlaybackManager {
  private player: PCMAudioPlayer;

  /** 外部事件回调，由 VoiceService 注入 */
  onEvent: PlaybackEventCallback | null = null;

  /**
   * @param config 播放配置（采样率、声道数、位深）
   */
  constructor(private readonly config: PlaybackConfig) {
    this.player = new PCMAudioPlayer({
      sampleRate: config.sampleRate,
      channels: config.channels,
      bitsPerSample: config.bitsPerSample,
    });
  }

  /**
   * 播放音频数据
   *
   * 自动处理格式转换：
   * - WAV 格式 → 剥离 44 字节 WAV 头
   * - 其他格式 → 通过 ffmpeg 转 PCM16
   * - ffmpeg 不可用 → 直接尝试播放原始数据
   *
   * @param audioData 音频 Buffer
   * @param audioFormat 音频格式（'wav' | 'pcm' | 'mp3' | 'opus' 等）
   */
  async play(audioData: Buffer, audioFormat?: string): Promise<void> {
    const otel = getOTelTracing();
    return otel.wrap(
      {
        name: 'voice.playback.play',
        attributes: {
          audioLength: audioData?.length ?? 0,
          format: audioFormat ?? 'unknown',
        },
      },
      async () => {
        if (!audioData || audioData.length === 0) {
          logger.warn('PlaybackManager · 无音频数据，跳过播放');
          this.emit('playback:end', { success: false, reason: '无音频数据' });
          return;
        }

        try {
          const pcmData = await this.toPcm(audioData, audioFormat);
          await this.player.play(pcmData);
          this.emit('playback:end', { success: true });
        } catch (error) {
          void handleError(error, {
            module: 'services:voice:playbackManager',
            action: 'play',
          });
          this.emit('playback:error', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    )();
  }

  /**
   * 将任意格式音频转换为 PCM16 裸数据
   *
   * @param audioData 原始音频 Buffer
   * @param audioFormat 原始格式
   * @returns PCM16 裸数据 Buffer
   */
  private async toPcm(
    audioData: Buffer,
    audioFormat?: string
  ): Promise<Buffer> {
    if (audioFormat === 'wav' || audioFormat === 'pcm') {
      // WAV 格式：去掉 44 字节 WAV 头，取出 PCM16 数据
      return this.stripWavHeader(audioData);
    }

    if (isFFmpegAvailable()) {
      // 非 PCM16 格式（如 MP3/Opus）：通过 ffmpeg 转换为 WAV
      return this.convertToPcm(audioData, audioFormat);
    }

    // ffmpeg 不可用，尝试直接作为 PCM16 播放（可能失败但不崩溃）
    logger.warn('PlaybackManager · ffmpeg 不可用，尝试直接播放');
    return audioData;
  }

  /**
   * 剥离 WAV 文件头，返回裸 PCM16 数据
   * WAV 头固定 44 字节
   */
  private stripWavHeader(wavBuffer: Buffer): Buffer {
    if (wavBuffer.length <= WAV_HEADER_SIZE) {
      return wavBuffer;
    }
    return wavBuffer.subarray(WAV_HEADER_SIZE);
  }

  /**
   * 通过 ffmpeg 将任意格式音频转换为 PCM16
   * 使用临时文件进行格式转换
   */
  private async convertToPcm(
    audioData: Buffer,
    audioFormat?: string
  ): Promise<Buffer> {
    const ext = audioFormat === 'mp3' ? '.mp3' : '.bin';
    const tmpInput = join(tmpdir(), `tts_play_${randomUUID()}${ext}`);
    const tmpOutput = join(tmpdir(), `tts_play_${randomUUID()}.wav`);

    try {
      writeFileSync(tmpInput, audioData);

      const convResult = AudioFormatConverter.convert({
        inputPath: tmpInput,
        outputPath: tmpOutput,
        targetFormat: 'wav',
      });

      if (convResult.success && convResult.outputPath) {
        const wavBuffer = readFileSync(convResult.outputPath);
        return this.stripWavHeader(wavBuffer);
      }

      logger.warn('PlaybackManager · 格式转换失败，返回原始数据');
      return audioData;
    } catch (error) {
      logger.warn('PlaybackManager · 转换异常', {
        error: error instanceof Error ? error.message : String(error),
      });
      return audioData;
    } finally {
      try {
        unlinkSync(tmpInput);
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(tmpOutput);
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * 发射播放事件
   */
  private emit(event: string, data: Record<string, unknown>): void {
    if (this.onEvent) {
      this.onEvent(event, data);
    }
  }

  /**
   * 销毁播放管理器，释放资源
   */
  destroy(): void {
    logger.debug('PlaybackManager · 销毁');
    this.onEvent = null;
    // PCMAudioPlayer 无公开 close/destroy 方法，此处保留扩展点
  }
}
