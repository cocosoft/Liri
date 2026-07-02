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
import { Logger, getOTelTracing } from '@modules/monitoring';
import { isFFmpegAvailable } from './audioFormatConverter';

const logger = new Logger({ module: 'voice:audio:pipeline' });

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
 * STT 输入音频前处理选项
 */
export interface AudioPreprocessOptions {
  /** 噪声门控 RMS 阈值（低于此值的帧视为噪声，0.0 ~ 1.0），默认 0.005 */
  noiseGateThreshold?: number;
  /** 音量归一化目标 RMS 值（0.0 ~ 1.0），默认 0.15（约 -16dB） */
  normalizationTarget?: number;
  /** 静音检测 RMS 阈值（0.0 ~ 1.0），默认 0.002 */
  silenceThreshold?: number;
  /** 静音裁剪最小静音时长（毫秒），默认 500 */
  minSilenceMs?: number;
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

// ===========================================================
// 纯 JS WAV 编解码（ffmpeg fallback）
// ===========================================================

/**
 * 纯 JS WAV 解码：从 WAV Buffer 中提取 PCM 数据
 *
 * 解析 WAV 文件头，提取 fmt 块信息（采样率、声道数、位深），
 * 定位 data 块并返回裸 PCM 数据。
 *
 * 仅支持 PCM 格式 WAV（不支持压缩格式如 ADPCM、MP3-in-WAV）。
 *
 * @param wavData 完整 WAV 文件 Buffer
 * @returns PCM 数据与格式信息，或 null（解析失败/非 PCM 格式）
 */
export function decodeWav(wavData: Buffer): {
  pcmData: Buffer;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
} | null {
  if (
    wavData.length < 44 ||
    wavData.toString('ascii', 0, 4) !== 'RIFF' ||
    wavData.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    return null;
  }

  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let pcmStart = 0;
  let pcmSize = 0;

  let offset = 12;
  while (offset + 8 <= wavData.length) {
    const chunkId = wavData.toString('ascii', offset, offset + 4);
    const chunkSize = wavData.readUInt32LE(offset + 4);

    if (chunkId === 'fmt ') {
      if (offset + 16 > wavData.length) return null;
      audioFormat = wavData.readUInt16LE(offset + 8);
      channels = wavData.readUInt16LE(offset + 10);
      sampleRate = wavData.readUInt32LE(offset + 12);
      bitsPerSample = wavData.readUInt16LE(offset + 22);
    } else if (chunkId === 'data') {
      pcmStart = offset + 8;
      pcmSize = chunkSize;
    }

    offset += 8 + chunkSize;
  }

  // 仅支持 PCM 格式（audioFormat === 1）
  if (audioFormat !== 1 || channels === 0 || pcmSize === 0) {
    return null;
  }

  const pcmData = wavData.subarray(pcmStart, pcmStart + pcmSize);

  return { pcmData, sampleRate, channels, bitsPerSample };
}

/**
 * 纯 JS WAV 编码：将 PCM 数据包装为 WAV 格式
 *
 * 生成标准的 RIFF/WAVE 文件头，包含 fmt 块和 data 块。
 * 输出为 PCM 编码的 WAV（audioFormat = 1）。
 *
 * 适用范围：仅 PCM ↔ WAV 互转。MP3、OGG、WebM 等其他格式仍依赖 ffmpeg。
 *
 * @param pcmData 裸 PCM 数据（Buffer）
 * @param sampleRate 采样率（Hz），如 16000、44100
 * @param channels 声道数（1=单声道，2=立体声）
 * @param bitsPerSample 位深（8 或 16）
 * @returns 完整 WAV 文件 Buffer
 */
function encodeWav(
  pcmData: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number
): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = pcmData.length;
  const fileSize = 36 + dataSize;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  // RIFF header
  header.write('RIFF', 0);
  header.writeUInt32LE(fileSize, 4);
  header.write('WAVE', 8);
  // fmt chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // chunk size (PCM = 16)
  header.writeUInt16LE(1, 20); // audio format (PCM = 1)
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  // data chunk
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
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
    const otel = getOTelTracing();
    return otel.wrap(
      {
        name: 'voice.audioPipeline.toSTTFormat',
        attributes: {
          inputFormat: this.inputFormat.format,
          inputSampleRate: this.inputFormat.sampleRate,
          inputChannels: this.inputFormat.channels,
        },
      },
      async () => {
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
    )();
  }

  /**
   * 转换为 TTS 输出格式：WAV 16kHz 单声道
   *
   * @returns WAV 格式的 Buffer 与元数据
   */
  async toTTSFormat(): Promise<TTSFormatBuffer> {
    const otel = getOTelTracing();
    return otel.wrap(
      {
        name: 'voice.audioPipeline.toTTSFormat',
        attributes: {
          inputFormat: this.inputFormat.format,
          inputSampleRate: this.inputFormat.sampleRate,
          inputChannels: this.inputFormat.channels,
        },
      },
      async () => {
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
    )();
  }

  /**
   * STT 输入音频前处理管线
   *
   * 4 阶段处理：
   *   1. 重采样到 16kHz mono（复用 toSTTFormat）
   *   2. 噪声门控：RMS 低于阈值的样本置零
   *   3. 音量归一化：线性放大到目标 RMS
   *   4. 静音裁剪：移除首尾静音段
   *
   * @param options 预处理选项
   * @returns 预处理后的 PCM16 16kHz mono Buffer
   */
  async preprocessForSTT(
    options?: AudioPreprocessOptions
  ): Promise<STTFormatBuffer> {
    const otel = getOTelTracing();
    return otel.wrap(
      {
        name: 'voice.audioPipeline.preprocessForSTT',
        attributes: {
          inputFormat: this.inputFormat.format,
          inputSampleRate: this.inputFormat.sampleRate,
          inputChannels: this.inputFormat.channels,
        },
      },
      async () => {
        // Step 1: 重采样到 16kHz mono
        const sttBuffer = await this.toSTTFormat();
        let pcmData = sttBuffer.data;

        const noiseGate = options?.noiseGateThreshold ?? 0.005;
        const normTarget = options?.normalizationTarget ?? 0.15;
        const silenceThresh = options?.silenceThreshold ?? 0.002;
        const minSilenceSamples = Math.max(
          1,
          Math.round(((options?.minSilenceMs ?? 500) / 1000) * 16000)
        );

        // PCM16 s16le → Float32 数组
        const sampleCount = Math.floor(pcmData.length / 2);
        const samples = new Float32Array(sampleCount);
        for (let i = 0; i < sampleCount; i++) {
          samples[i] = pcmData.readInt16LE(i * 2) / 32768;
        }

        // Step 2: 噪声门控 — 按帧计算 RMS，低于阈值的帧置零
        const frameSize = 256; // 16ms @ 16kHz
        const numFrames = Math.ceil(sampleCount / frameSize);
        for (let f = 0; f < numFrames; f++) {
          const start = f * frameSize;
          const end = Math.min(start + frameSize, sampleCount);
          let sumSq = 0;
          for (let s = start; s < end; s++) {
            sumSq += samples[s] * samples[s];
          }
          const rms = Math.sqrt(sumSq / (end - start));
          if (rms < noiseGate) {
            samples.fill(0, start, end);
          }
        }

        // Step 3: 音量归一化 — 计算全局 RMS，线性放大到目标值
        let sumSq = 0;
        for (let i = 0; i < sampleCount; i++) {
          sumSq += samples[i] * samples[i];
        }
        const currentRms = Math.sqrt(sumSq / sampleCount);
        if (currentRms > 0.0001 && currentRms < normTarget) {
          const gain = normTarget / currentRms;
          for (let i = 0; i < sampleCount; i++) {
            samples[i] = Math.max(-1, Math.min(1, samples[i] * gain));
          }
        }

        // Step 4: 静音裁剪 — 移除首尾静音段
        let leadingSilence = 0;
        for (let i = 0; i + minSilenceSamples <= sampleCount; i++) {
          let isSilent = true;
          for (let j = 0; j < minSilenceSamples; j++) {
            if (Math.abs(samples[i + j]) > silenceThresh) {
              isSilent = false;
              break;
            }
          }
          if (isSilent) {
            leadingSilence = i + minSilenceSamples;
            i += minSilenceSamples - 1;
          } else {
            break;
          }
        }

        let trailingSilence = sampleCount;
        for (let i = sampleCount - minSilenceSamples; i >= 0; i--) {
          let isSilent = true;
          for (let j = 0; j < minSilenceSamples; j++) {
            if (Math.abs(samples[i + j]) > silenceThresh) {
              isSilent = false;
              break;
            }
          }
          if (isSilent) {
            trailingSilence = i;
            i -= minSilenceSamples - 1;
          } else {
            break;
          }
        }

        const trimmedStart = Math.max(0, leadingSilence);
        const trimmedEnd = Math.min(sampleCount, trailingSilence);

        // Float32 → PCM16 s16le Buffer
        const outSampleCount = Math.max(0, trimmedEnd - trimmedStart);
        // 至少返回 1 个样本（避免空 Buffer）
        const finalCount = Math.max(outSampleCount, 1);
        const outBuffer = Buffer.alloc(finalCount * 2);
        for (let i = 0; i < finalCount && trimmedStart + i < sampleCount; i++) {
          const val = Math.max(-1, Math.min(1, samples[trimmedStart + i]));
          outBuffer.writeInt16LE(Math.round(val * 32768), i * 2);
        }

        logger.info('STT 音频前处理完成', {
          inputSamples: sampleCount,
          outputSamples: finalCount,
          trimmedStart,
          trimmedEnd,
          currentRms: Math.round(currentRms * 1000) / 1000,
        });

        return {
          data: outBuffer,
          sampleRate: 16000 as const,
          channels: 1 as const,
          format: 'pcm_s16le' as const,
        };
      }
    )();
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
   * 当 ffmpeg 不可用时，自动降级到纯 JS WAV 编解码：
   *   - s16le ← WAV：decodeWav 剥离 WAV 头
   *   - WAV ← s16le：encodeWav 添加 WAV 头
   *   其他组合（需重采样或编解码非 WAV 格式）则抛出明确错误。
   *
   * @param opts 转换目标参数
   * @returns 转换后的音频 Buffer
   */
  private async ffmpegConvert(opts: {
    outputFormat: string;
    sampleRate: number;
    channels: number;
  }): Promise<Buffer> {
    if (!isFFmpegAvailable()) {
      return this.tryJSWavFallback(opts);
    }

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

  /**
   * 纯 JS WAV 编解码回退
   *
   * 当 ffmpeg 不可用时，尝试用纯 JS 处理 PCM ↔ WAV 互转。
   * 仅支持以下场景（无需重采样/声道混音）：
   *   - WAV → s16le：输入为 WAV 格式，提取 PCM 数据
   *   - s16le → WAV：输入为 PCM16 格式，包装为 WAV
   *
   * @param opts 转换目标参数
   * @returns 转换后的音频 Buffer
   */
  private tryJSWavFallback(opts: {
    outputFormat: string;
    sampleRate: number;
    channels: number;
  }): Buffer {
    const targetIsPcm = opts.outputFormat === 's16le';
    const targetIsWav = opts.outputFormat === 'wav';

    if (targetIsPcm && this.inputFormat.format === 'wav') {
      // WAV → PCM16：解码 WAV 提取裸数据
      const decoded = decodeWav(this.data);
      if (decoded) {
        if (
          decoded.sampleRate === opts.sampleRate &&
          decoded.channels === opts.channels &&
          decoded.bitsPerSample === 16
        ) {
          logger.info('JS WAV fallback · WAV → PCM16 解码成功', {
            sampleRate: decoded.sampleRate,
            channels: decoded.channels,
            size: decoded.pcmData.length,
          });
          return decoded.pcmData;
        }

        // 采样率或声道不匹配时，无法用纯 JS 处理
        logger.warn(
          'JS WAV fallback · 输入 WAV 参数与目标不匹配，需要 ffmpeg 重采样',
          {
            input: {
              sampleRate: decoded.sampleRate,
              channels: decoded.channels,
            },
            target: { sampleRate: opts.sampleRate, channels: opts.channels },
          }
        );
      }
    } else if (targetIsWav && this.inputFormat.format === 'pcm_s16le') {
      // PCM16 → WAV：包装为 WAV 格式
      logger.info('JS WAV fallback · PCM16 → WAV 编码成功', {
        sampleRate: this.inputFormat.sampleRate,
        channels: this.inputFormat.channels,
        size: this.data.length,
      });
      return encodeWav(this.data, opts.sampleRate, opts.channels, 16);
    }

    throw new Error(
      'ffmpeg 不可用且无法通过纯 JS 编解码完成转换。' +
        'JS fallback 仅支持 PCM ↔ WAV 互转（需采样率和声道数一致），' +
        `当前输入格式: ${this.inputFormat.format}，目标: ${opts.outputFormat}。` +
        '请安装 ffmpeg 或确保音频已是目标格式。'
    );
  }
}

// ===========================================================
// PCM 中间缓存（方案 A）
// ===========================================================

/** PCM 缓存项 */
interface PCMCacheEntry {
  /** 缓存数据（PCM16 16kHz mono Buffer） */
  data: Buffer;
  /** 缓存创建时间戳 */
  createdAt: number;
}

/**
 * PCMCache — PCM 音频中间缓存
 *
 * 缓存 PCM16 16kHz mono 格式的音频数据，避免重复转换相同内容。
 * 配置 TTL 过期自动清理，支持主动失效。
 *
 * @example
 *   const cache = new PCMCache(60000); // TTL 60 秒
 *   cache.set('voice-zh-CN-hello', pcmBuffer);
 *   const cached = cache.get('voice-zh-CN-hello');
 */
export class PCMCache {
  /** 缓存容器 */
  private store = new Map<string, PCMCacheEntry>();
  /** TTL（毫秒），默认 60 秒 */
  private ttl: number;

  /**
   * @param ttl 缓存 TTL（毫秒），默认 60000
   */
  constructor(ttl: number = 60000) {
    this.ttl = ttl;
  }

  /**
   * 获取缓存
   *
   * @param key 缓存键
   * @returns PCM 数据，或 undefined（未命中 / 已过期）
   */
  get(key: string): Buffer | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.createdAt > this.ttl) {
      this.store.delete(key);
      return undefined;
    }

    logger.debug('PCMCache · 命中缓存', { key, size: entry.data.length });
    return entry.data;
  }

  /**
   * 写入缓存
   *
   * @param key 缓存键
   * @param data PCM16 16kHz mono 数据
   */
  set(key: string, data: Buffer): void {
    this.store.set(key, {
      data,
      createdAt: Date.now(),
    });
  }

  /**
   * 主动失效指定 key
   *
   * @param key 缓存键
   */
  delete(key: string): void {
    this.store.delete(key);
  }

  /**
   * 清空全部缓存
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * 清理过期条目
   *
   * @returns 清理的条目数
   */
  evictExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [key, entry] of this.store) {
      if (now - entry.createdAt > this.ttl) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * 当前缓存大小
   */
  get size(): number {
    return this.store.size;
  }
}
