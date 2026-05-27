/**
 * AudioPipeline
 * 音频缓冲区管理、PCM 编码/解码、分片处理
 * 支持 PCM 16kHz mono 格式，与 Gemini Live API 默认输入格式一致
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/** 音频格式常量 */
export const AUDIO_FORMAT = {
  SAMPLE_RATE: 16000,
  CHANNELS: 1,
  BITS_PER_SAMPLE: 16,
  BYTES_PER_SAMPLE: 2,
} as const;

/** 默认分片大小（20ms 的 PCM 数据字节数） */
export const DEFAULT_CHUNK_SIZE_BYTES =
  AUDIO_FORMAT.SAMPLE_RATE *
  AUDIO_FORMAT.CHANNELS *
  AUDIO_FORMAT.BYTES_PER_SAMPLE *
  0.02;

/** 音频缓冲区统计 */
export interface AudioBufferStats {
  /** 缓冲区大小（字节） */
  size: number;
  /** 分片数量 */
  chunks: number;
  /** 预估时长（毫秒） */
  durationMs: number;
}

/** 音频分片 */
export interface AudioChunk {
  /** 分片序号 */
  index: number;
  /** Base64 编码的 PCM 数据 */
  data: string;
  /** 原始字节长度 */
  byteLength: number;
  /** 时间戳 */
  timestamp: number;
}

/**
 * PCM 音频缓冲区
 * 管理音频数据的写入、读取和分片
 */
export class PCMAudioBuffer {
  private chunks: Buffer[] = [];
  private totalBytes: number = 0;
  private chunkIndex: number = 0;

  /** 将 PCM 字节数转换为时长（毫秒） */
  bytesToMs(bytes: number): number {
    const bytesPerSecond =
      AUDIO_FORMAT.SAMPLE_RATE *
      AUDIO_FORMAT.CHANNELS *
      AUDIO_FORMAT.BYTES_PER_SAMPLE;
    return (bytes / bytesPerSecond) * 1000;
  }

  /** 将时长（毫秒）转换为 PCM 字节数 */
  msToBytes(ms: number): number {
    const bytesPerSecond =
      AUDIO_FORMAT.SAMPLE_RATE *
      AUDIO_FORMAT.CHANNELS *
      AUDIO_FORMAT.BYTES_PER_SAMPLE;
    return Math.floor((ms / 1000) * bytesPerSecond);
  }

  /** 追加 Base64 PCM 数据 */
  appendBase64(base64Data: string): void {
    const buf = Buffer.from(base64Data, 'base64');
    this.chunks.push(buf);
    this.totalBytes += buf.length;
    logger.info('AudioPipeline · 追加 Base64 数据', {
      bytes: buf.length,
      total: this.totalBytes,
    });
  }

  /** 追加原始 Buffer */
  appendBuffer(buffer: Buffer): void {
    this.chunks.push(buffer);
    this.totalBytes += buffer.length;
    logger.info('AudioPipeline · 追加 Buffer', {
      bytes: buffer.length,
      total: this.totalBytes,
    });
  }

  /** 获取缓冲区统计 */
  getStats(): AudioBufferStats {
    const stats = {
      size: this.totalBytes,
      chunks: this.chunks.length,
      durationMs: this.bytesToMs(this.totalBytes),
    };
    logger.info('AudioPipeline · 缓冲区统计', stats);
    return stats;
  }

  /** 清空缓冲区 */
  clear(): void {
    this.chunks = [];
    this.totalBytes = 0;
    this.chunkIndex = 0;
    logger.info('AudioPipeline · 缓冲区已清空');
  }

  /** 获取当前所有数据合并后的 Buffer */
  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }

  /** 获取当前所有数据的 Base64 编码 */
  toBase64(): string {
    return this.toBuffer().toString('base64');
  }

  /**
   * 将缓冲区数据切割为固定大小的分片
   * @param chunkSizeBytes 每个分片的字节数，默认 20ms
   * @returns 音频分片数组
   */
  toChunks(chunkSizeBytes: number = DEFAULT_CHUNK_SIZE_BYTES): AudioChunk[] {
    const merged = this.toBuffer();
    const chunks: AudioChunk[] = [];
    let offset = 0;
    let index = this.chunkIndex;

    while (offset < merged.length) {
      const end = Math.min(offset + chunkSizeBytes, merged.length);
      const slice = merged.subarray(offset, end);
      chunks.push({
        index: index++,
        data: slice.toString('base64'),
        byteLength: slice.length,
        timestamp: Date.now(),
      });
      offset = end;
    }

    this.chunkIndex = index;
    logger.info('AudioPipeline · 分片完成', {
      count: chunks.length,
      totalBytes: this.totalBytes,
    });
    return chunks;
  }
}

/**
 * 音频数据处理器
 * 提供 PCM 数据的工具方法
 */
export class AudioProcessor {
  /**
   * 将 Float32Array 转换为 PCM16 Buffer
   * @param samples Float32 音频样本（范围 -1.0 ~ 1.0）
   * @returns PCM16 Buffer
   */
  static float32ToPcm16(samples: Float32Array): Buffer {
    const buffer = Buffer.alloc(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      const val = s < 0 ? s * 0x8000 : s * 0x7fff;
      buffer.writeInt16LE(Math.round(val), i * 2);
    }
    return buffer;
  }

  /**
   * 将 PCM16 Buffer 转换为 Float32Array
   * @param buffer PCM16 Buffer
   * @returns Float32 音频样本
   */
  static pcm16ToFloat32(buffer: Buffer): Float32Array {
    const samples = new Float32Array(buffer.length / 2);
    for (let i = 0; i < samples.length; i++) {
      const val = buffer.readInt16LE(i * 2);
      samples[i] = val / (val < 0 ? 0x8000 : 0x7fff);
    }
    return samples;
  }

  /**
   * 计算音频分片数量
   * @param durationMs 音频时长（毫秒）
   * @param chunkSizeMs 分片时长（毫秒），默认 20ms
   * @returns 分片数量
   */
  static estimateChunkCount(
    durationMs: number,
    chunkSizeMs: number = 20
  ): number {
    return Math.ceil(durationMs / chunkSizeMs);
  }
}
