/**
 * AudioPipeline
 * 音频管线统一抽象层
 *
 * 统一管理音频数据的格式声明与格式转换，消除散落在各模块中的隐式格式假设。
 * 转换使用 ffmpeg 子进程的管道模式（stdin → stdout），避免临时文件 I/O。
 *
 * @example
 *   // 从 Buffer 创建，自动转换为 STT 期望格式
 *   const pipe = AudioPipeline.fromBuffer(wavBuffer, { format: 'wav', sampleRate: 48000, channels: 2 });
 *   const { data } = await pipe.toSTTFormat();
 *   const result = await stt.transcribe(data);
 */

import { spawn } from 'child_process';
import { createReadStream } from 'fs';
import { readFile } from 'fs/promises';
import { Readable } from 'stream';
import { handleError } from '@modules/error';
import { Logger } from '@modules/monitoring';

const logger = new Logger({});

/** 支持的音频格式类型 */
export type PipelineFormat = 'wav' | 'pcm_s16le' | 'mp3' | 'opus';

/** 音频格式描述 */
export interface AudioFormatDesc {
  format: PipelineFormat;
  sampleRate: number;
  channels: number;
}

/** PCM16 16kHz 单声道 Buffer（STT 期望格式） */
export interface STTFormatBuffer {
  data: Buffer;
  sampleRate: 16000;
  channels: 1;
  format: 'pcm_s16le';
}

/** WAV Buffer（TTS 常用输出格式） */
export interface TTSFormatBuffer {
  data: Buffer;
  format: 'wav';
  sampleRate: number;
  channels: number;
}

/**
 * 解析 WAV Buffer 头部的采样率和声道数
 *
 * WAV 文件结构：
 *   RIFF Header: "RIFF" + size(4) + "WAVE" = 12 bytes
 *   fmt chunk:   "fmt " + size(4) + audioFormat(2) + channels(2) + sampleRate(4) + byteRate(4) + blockAlign(2) + bitsPerSample(2)
 *
 * @returns 格式描述，或 null（无法解析）
 */
function parseWavHeader(buffer: Buffer): AudioFormatDesc | null {
  // 检查 RIFF 头和 WAVE 标识
  if (
    buffer.length < 44 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    return null;
  }

  // 找到 fmt 块
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ') {
      const audioFormat = buffer.readUInt16LE(offset + 8);
      if (audioFormat !== 1) {
        // 仅支持 PCM 格式
        return null;
      }
      return {
        format: 'wav',
        sampleRate: buffer.readUInt32LE(offset + 12),
        channels: buffer.readUInt16LE(offset + 10),
      };
    }
    offset += 8 + chunkSize;
  }
  return null;
}

/**
 * 音频管线 — 统一音频格式抽象层
 *
 * 持有一个音频 Buffer 及其格式描述，提供格式转换方法。
 * 转换通过 ffmpeg 管道模式完成，不写临时文件。
 */
export class AudioPipeline {
  /** 音频数据 Buffer */
  private data: Buffer;
  /** 输入格式描述 */
  private inputFormat: AudioFormatDesc;

  /**
   * @param data 音频数据
   * @param inputFormat 输入格式描述
   */
  private constructor(data: Buffer, inputFormat: AudioFormatDesc) {
    this.data = data;
    this.inputFormat = inputFormat;
  }

  /** 输入格式（只读副本） */
  get input(): AudioFormatDesc {
    return { ...this.inputFormat };
  }

  /** 原始数据长度（字节） */
  get size(): number {
    return this.data.length;
  }

  // ========== 格式转换 ==========

  /**
   * 转换为 STT 期望的格式：PCM16 16kHz 单声道
   *
   * 如果输入已经是 PCM16 16kHz 单声道，跳过转换直接返回。
   *
   * @returns STT 格式的 Buffer 与元数据
   */
  async toSTTFormat(): Promise<STTFormatBuffer> {
    if (this.isPcm16_16kHzMono()) {
      return {
        data: this.data,
        sampleRate: 16000 as const,
        channels: 1 as const,
        format: 'pcm_s16le' as const,
      };
    }

    const converted = await this.ffmpegConvert({
      outputFormat: 's16le',
      sampleRate: 16000,
      channels: 1,
    });

    return {
      data: converted,
      sampleRate: 16000 as const,
      channels: 1 as const,
      format: 'pcm_s16le' as const,
    };
  }

  /**
   * 转换为 TTS 输出格式：WAV 16kHz 单声道
   *
   * @returns WAV 格式的 Buffer 与元数据
   */
  async toTTSFormat(): Promise<TTSFormatBuffer> {
    if (
      this.inputFormat.format === 'wav' &&
      this.inputFormat.sampleRate === 16000 &&
      this.inputFormat.channels === 1
    ) {
      return {
        data: this.data,
        format: 'wav' as const,
        sampleRate: 16000,
        channels: 1,
      };
    }

    const converted = await this.ffmpegConvert({
      outputFormat: 'wav',
      sampleRate: 16000,
      channels: 1,
    });

    const parsed = parseWavHeader(converted);
    return {
      data: converted,
      format: 'wav' as const,
      sampleRate: parsed?.sampleRate ?? 16000,
      channels: parsed?.channels ?? 1,
    };
  }

  // ========== 静态工厂方法 ==========

  /**
   * 从 Buffer 创建管线
   *
   * @param data 音频数据
   * @param format 格式描述（WAV 格式可省略，会自动从头部解析）
   * @returns AudioPipeline 实例
   */
  static fromBuffer(data: Buffer, format?: AudioFormatDesc): AudioPipeline {
    if (!format) {
      // 尝试从 WAV 头部解析格式
      const parsed = parseWavHeader(data);
      if (parsed) {
        return new AudioPipeline(data, parsed);
      }
      // 无法解析时默认使用 PCM16 16kHz mono
      logger.warn(
        'AudioPipeline.fromBuffer · 无法自动检测格式，默认 PCM16 16kHz mono'
      );
      return new AudioPipeline(data, {
        format: 'pcm_s16le',
        sampleRate: 16000,
        channels: 1,
      });
    }

    return new AudioPipeline(data, format);
  }

  /**
   * 从文件创建管线
   *
   * WAV 文件会自动从头部解析采样率和声道数。
   * 非 WAV 文件（mp3/opus）需要显式传入 format 参数。
   *
   * @param path 文件路径
   * @param format 格式描述（非 WAV 文件必需）
   * @returns AudioPipeline 实例
   */
  static async fromFile(
    path: string,
    format?: AudioFormatDesc
  ): Promise<AudioPipeline> {
    const data = await readFile(path);

    if (format) {
      return new AudioPipeline(data, format);
    }

    // 尝试自动解析 WAV 头部
    const parsed = parseWavHeader(data);
    if (parsed) {
      return new AudioPipeline(data, parsed);
    }

    throw new Error(
      `AudioPipeline.fromFile · 无法自动检测文件格式，请显式传入 format 参数: ${path}`
    );
  }

  /**
   * 从可读流创建管线（收集所有数据到 Buffer）
   *
   * @param stream 可读流
   * @param format 格式描述
   * @returns AudioPipeline 实例
   */
  static async fromStream(
    stream: Readable,
    format: AudioFormatDesc
  ): Promise<AudioPipeline> {
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const data = Buffer.concat(chunks);
    return new AudioPipeline(data, format);
  }

  // ========== 私有方法 ==========

  /**
   * 判断当前数据是否已经是 PCM16 16kHz 单声道
   */
  private isPcm16_16kHzMono(): boolean {
    return (
      this.inputFormat.format === 'pcm_s16le' &&
      this.inputFormat.sampleRate === 16000 &&
      this.inputFormat.channels === 1
    );
  }

  /**
   * 使用 ffmpeg 子进程管道转换音频格式
   *
   * @param opts 转换目标参数
   * @returns 转换后的音频 Buffer
   */
  private ffmpegConvert(opts: {
    outputFormat: string;
    sampleRate: number;
    channels: number;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const args = [
        '-i',
        'pipe:0',
        '-f',
        opts.outputFormat,
        '-ar',
        String(opts.sampleRate),
        '-ac',
        String(opts.channels),
        'pipe:1',
      ];

      const proc = spawn('ffmpeg', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(stdoutChunks));
        } else {
          const stderr = Buffer.concat(stderrChunks)
            .toString('utf8')
            .slice(0, 500);
          reject(new Error(`ffmpeg 转换失败 (exit ${code}): ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`ffmpeg 进程启动失败: ${err.message}`));
      });

      // 写入数据并关闭 stdin
      proc.stdin?.write(this.data);
      proc.stdin?.end();
    });
  }
}
