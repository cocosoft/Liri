/**
 * 音频归一化工具（语音系统升级 3.1 / P0-1）
 *
 * 统一 STT 入口的格式嗅探 + ffmpeg 转码兜底：
 * 前端 MediaRecorder 产出格式因平台而异（webm/ogg/mp4），本地 STT（faster-whisper/SenseVoice）
 * 只认 PCM/WAV，直接投喂会导致 soundfile 解析失败。此处嗅探 magic bytes，
 * 非 PCM/WAV 容器用 ffmpeg 转 PCM16 16kHz mono；ffmpeg 不可用时返回原样
 * （由调用方对 cloud Provider 放行——OpenAI Whisper API 原生支持 webm/ogg）。
 */

import { spawn } from 'child_process';

import { Logger, LogLevel } from '@modules/monitoring';
import { isFFmpegAvailable } from './audioFormatConverter.js';

const logger = new Logger({
  module: 'services:voice:services:audioNormalizer',
  level: LogLevel.INFO,
});

/** 音频容器类型 */
export type AudioContainer = 'wav' | 'webm' | 'ogg' | 'mp4' | 'pcm' | 'unknown';

/**
 * 长音频限长（秒，对齐方案 §6 风险缓解承诺）
 * 转码产物超过该时长截断，避免 ffmpeg 对长音频耗时/内存放大。
 */
const MAX_TRANSCRIBE_SECONDS = 30;

/** 限长对应的 PCM16 16kHz mono 字节数 */
const MAX_TRANSCRIBE_BYTES = MAX_TRANSCRIBE_SECONDS * 16000 * 2;

/**
 * 长音频 PCM 限长截断（§6 风险缓解）
 * 转码产物超过 30s（30 * 16kHz * 2B）时保留前段，返回新 Buffer。
 * @param pcm PCM16 16kHz mono 数据
 * @returns 截断后的数据（未超限时原样返回）
 */
export function limitPcmDuration(pcm: Buffer): Buffer {
  if (pcm.length <= MAX_TRANSCRIBE_BYTES) return pcm;
  logger.warn('STT 音频超过 30s 限长，截断至前 30s', {
    outBytes: pcm.length,
    maxBytes: MAX_TRANSCRIBE_BYTES,
  });
  return pcm.subarray(0, MAX_TRANSCRIBE_BYTES);
}

/**
 * 嗅探音频容器（magic bytes）
 * - RIFF....WAVE → wav
 * - OggS → ogg（vorbis/opus）
 * - 1A45DFA3 → webm（EBML/matroska）
 * - ftyp → mp4/m4a
 */
export function detectAudioContainer(buffer: Buffer): AudioContainer {
  if (!buffer || buffer.length < 12) return 'unknown';

  // RIFF | xxxx | WAVE
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46
  ) {
    return buffer.toString('latin1', 8, 12) === 'WAVE' ? 'wav' : 'unknown';
  }
  // OggS
  if (
    buffer[0] === 0x4f &&
    buffer[1] === 0x67 &&
    buffer[2] === 0x67 &&
    buffer[3] === 0x53
  ) {
    return 'ogg';
  }
  // EBML（webm/mkv）
  if (
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return 'webm';
  }
  // ftyp（mp4/m4a，offset 4）
  if (
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    return 'mp4';
  }
  return 'unknown';
}

/** 归一化结果 */
export interface NormalizedAudio {
  /** 实际用于转录的音频数据 */
  buffer: Buffer;
  /** 原始容器类型 */
  container: AudioContainer;
  /** 是否发生了转码 */
  converted: boolean;
}

/**
 * 转 PCM16 16kHz mono（ffmpeg 管道，参数数组避免注入）
 * 3.13/P2-9：导出供 PlaybackManager 播放解码复用（单一实现）
 */
export function transcodeToPcm16(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i',
      'pipe:0',
      '-f',
      's16le',
      '-ar',
      '16000',
      '-ac',
      '1',
      'pipe:1',
    ]);
    const chunks: Buffer[] = [];
    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    // stderr 静默消费，错误以退出码判断
    proc.stderr.on('data', () => {});
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`ffmpeg 转码失败，退出码 ${code}`));
      }
    });
    proc.stdin.write(input);
    proc.stdin.end();
  });
}

/**
 * 归一化音频供 STT 使用（3.1 / P0-1）
 * 非 PCM/WAV 容器且 ffmpeg 可用 → 转码；否则原样返回（cloud 兜底）。
 */
export async function normalizeAudioForSTT(
  input: Buffer
): Promise<NormalizedAudio> {
  const container = detectAudioContainer(input);
  if (container === 'wav' || container === 'pcm' || container === 'unknown') {
    return { buffer: input, container, converted: false };
  }

  if (!isFFmpegAvailable()) {
    logger.warn(
      '检测到非 WAV 音频且 ffmpeg 不可用，原样透传（cloud Provider 可识别）',
      {
        container,
      }
    );
    return { buffer: input, container, converted: false };
  }

  try {
    const pcm = limitPcmDuration(await transcodeToPcm16(input));
    logger.info('STT 音频已转码', {
      container,
      inBytes: input.length,
      outBytes: pcm.length,
    });
    return { buffer: pcm, container, converted: true };
  } catch (err) {
    logger.warn('STT 音频转码失败，原样透传', {
      container,
      error: err instanceof Error ? err.message : String(err),
    });
    return { buffer: input, container, converted: false };
  }
}
