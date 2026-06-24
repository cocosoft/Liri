/**
 * 语音服务
 * 提供语音输入和输出功能
 *
 * 统一合并自 voice.ts（录音功能）、VoiceService.ts（事件系统）、voiceService.ts（类封装）
 */

import { readFile, writeFile, unlink } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Logger } from '@modules/monitoring';
import { handleError } from '@modules/error';

import type {
  VoiceDependencies,
  RecordingOptions,
  RecordingResult,
  RecordingStateHandler,
  VoiceOutputOptions,
  VoiceServiceConfig,
  VoiceEventType,
  VoiceEvent,
  VoiceEventListener,
  STTResult,
  STTTranscribeOptions,
} from '../models/types';

import { VadDetector } from './vadDetector';
import { EnvironmentDetector } from './environmentDetector';
import { TTSRegistry } from './ttsProvider';
import { STTRegistry } from './sttRegistry';
import { TTSPersonaManager } from './ttsPersonaManager';
import { AudioLevelMeter } from './audioLevelMeter';
import {
  AudioFormatConverter,
  isFFmpegAvailable,
  getFormatInfo,
} from './audioFormatConverter';
import { pcm16BufferToSamples } from './audioUtils';
import type { AudioFormat } from './audioFormatConverter';
import { Recorder, type RecordingMethod } from './recorder';
import {
  checkVoiceDependencies,
  checkRecordingAvailability,
  RECORDING_SAMPLE_RATE,
  RECORDING_CHANNELS,
  RECORDING_BITS_PER_SAMPLE,
  SILENCE_DURATION_SECS,
  SILENCE_THRESHOLD,
} from './recordingDetector';

const logger = new Logger({});

/**
 * 文本归一化（STT 后处理）
 * 去除控制字符、多余空白，用于识别后的文本净化。
 *
 * @param text 原始识别文本
 * @returns 归一化后的文本
 */
function normalizeText(text: string): string {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // 去除控制字符
    .replace(/\r?\n/g, ' ') // 换行转空格
    .replace(/[ \t]+/g, ' ') // 合并连续空白
    .trim();
}

/**
 * 从 WAV 文件头解析录音时长（毫秒）
 *
 * WAV 头结构：
 *   bytes 24-27: sample rate
 *   bytes 34-35: bits per sample
 *   bytes 40-43: data chunk size（或从 RIFF 块大小推算）
 *
 * @param filePath WAV 文件路径
 * @returns 时长（毫秒），解析失败返回 0
 */
function readWavDuration(filePath: string): number {
  try {
    const header = readFileSync(filePath, { flag: 'r' }).subarray(0, 44);
    if (header.length < 44) {
      return 0;
    }

    const sampleRate = header.readUInt32LE(24);
    const bitsPerSample = header.readUInt16LE(34);
    const channels = header.readUInt16LE(22);
    const dataChunkSize = header.readUInt32LE(40);

    if (sampleRate === 0 || channels === 0 || bitsPerSample === 0) {
      return 0;
    }

    const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
    if (bytesPerSecond === 0) {
      return 0;
    }

    return Math.round((dataChunkSize / bytesPerSecond) * 1000);
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------
// 语音服务类
// ---------------------------------------------------------------

export class VoiceService {
  private config: VoiceServiceConfig;
  private listeners: Map<VoiceEventType, Set<VoiceEventListener>> = new Map();
  private isRecording: boolean = false;
  private isSpeaking: boolean = false;
  /** 音频电平表（录音时实时测量音量） */
  private levelMeter: AudioLevelMeter;
  /** 当前电平归一化值（0-1） */
  private currentLevel: number = 0;
  /** 录音器 */
  private recorder: Recorder;

  /**
   * @param config 语音服务配置
   */
  constructor(config: VoiceServiceConfig = {}) {
    this.config = {
      sampleRate: config.sampleRate || RECORDING_SAMPLE_RATE,
      channels: config.channels || RECORDING_CHANNELS,
      bitDepth: config.bitDepth || RECORDING_BITS_PER_SAMPLE,
      silenceThreshold: config.silenceThreshold ?? SILENCE_THRESHOLD,
      silenceDuration: config.silenceDuration ?? SILENCE_DURATION_SECS,
      language: config.language || 'zh-CN',
    };

    this.levelMeter = new AudioLevelMeter(
      this.config.sampleRate ?? RECORDING_SAMPLE_RATE
    );

    this.recorder = new Recorder({
      sampleRate: this.config.sampleRate ?? RECORDING_SAMPLE_RATE,
      channels: this.config.channels ?? RECORDING_CHANNELS,
      bitDepth: this.config.bitDepth ?? RECORDING_BITS_PER_SAMPLE,
      silenceThreshold: String(
        this.config.silenceThreshold ?? SILENCE_THRESHOLD
      ),
      silenceDuration: String(
        this.config.silenceDuration ?? SILENCE_DURATION_SECS
      ),
    });
  }

  // ===========================================================
  // 配置
  // ===========================================================

  /**
   * 获取配置（返回不可变拷贝）
   */
  getConfig(): VoiceServiceConfig {
    return {
      ...this.config,
      sttKeyterms: this.config.sttKeyterms
        ? [...this.config.sttKeyterms]
        : undefined,
    };
  }

  /**
   * 更新配置
   * @param config 部分配置
   */
  updateConfig(config: Partial<VoiceServiceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ===========================================================
  // 事件系统
  // ===========================================================

  /**
   * 添加事件监听器
   * @param type 事件类型
   * @param listener 监听器
   */
  addEventListener(type: VoiceEventType, listener: VoiceEventListener): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  /**
   * 移除事件监听器
   * @param type 事件类型
   * @param listener 监听器
   */
  removeEventListener(
    type: VoiceEventType,
    listener: VoiceEventListener
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  /**
   * 触发事件
   * @param type 事件类型
   * @param data 事件数据
   */
  private emit(type: VoiceEventType, data?: unknown): void {
    const event: VoiceEvent = {
      type,
      data,
      timestamp: Date.now(),
    };
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  /**
   * 录音中是否
   */
  isRecordingActive(): boolean {
    return this.isRecording;
  }

  /**
   * 是否正在说话
   */
  isSpeakingActive(): boolean {
    return this.isSpeaking;
  }

  // ===========================================================
  // 依赖检查与环境检测
  // ===========================================================

  /**
   * 检查语音依赖
   *
   * 返回各平台可用的录音方法和缺失的依赖信息。
   * 委托给 recordingDetector 模块的纯函数。
   */
  async checkVoiceDependencies(): Promise<VoiceDependencies> {
    return await checkVoiceDependencies();
  }

  /**
   * 检查录音可用性
   *
   * 委托给 recordingDetector 模块的纯函数。
   */
  async checkRecordingAvailability(): Promise<VoiceDependencies> {
    return await checkRecordingAvailability();
  }

  // ===========================================================
  // 录音
  // ===========================================================

  /**
   * 开始录音
   *
   * 自动选择可用的录音工具，支持 SoX、arecord、PowerShell 三种方式。
   * 录音数据通过 onData 回调实时返回，录音结束时触发 onEnd。
   *
   * 对 arecord（无内置静音检测）自动添加 VAD 静音检测和自动停止；
   * 对所有流式录音方法自动运行环境检测以适配 VAD 参数。
   *
   * @param onData 音频数据回调
   * @param onEnd 录音结束回调
   * @param options 录音选项
   */
  async startRecording(
    onData: (chunk: Buffer) => void,
    onEnd: () => void,
    options?: RecordingOptions
  ): Promise<boolean> {
    this.stopRecording();

    if (this.isRecording) {
      return false;
    }

    const deps = await this.checkRecordingAvailability();
    if (!deps.available || !deps.method) {
      return false;
    }

    this.isRecording = true;
    this.emit('start');

    // 重置电平表
    this.levelMeter.reset();
    this.currentLevel = 0;

    // 创建环境检测器与 VAD（arecord 无内置静音检测，需要软件 VAD）
    const sampleRate = this.config.sampleRate ?? RECORDING_SAMPLE_RATE;
    const envDetector = new EnvironmentDetector({ sampleRate });
    const useVad = deps.method === 'arecord' || deps.method === 'powershell';
    let vad: VadDetector | null = null;
    let wasSpeaking = false;
    /** 初始静音帧计数器（约 5 秒无语音时自动停止） */
    let initialSilenceChunks = 0;
    const MAX_INITIAL_SILENCE_CHUNKS = 40; // ~5s @ ~8 chunks/s

    if (useVad) {
      vad = new VadDetector(sampleRate, {
        minSpeechDurationMs: 150,
        silenceHoldMs: 2000,
      });
    }

    /**
     * 包装 onData 回调，集成环境检测、VAD 静音检测和电平测量
     */
    const wrappedOnData = (chunk: Buffer) => {
      const samples = pcm16BufferToSamples(chunk);

      // 电平表处理（实时计算录音音量）
      const levelResult = this.levelMeter.processFloat64(samples);
      if (levelResult) {
        this.currentLevel = levelResult.normalized;
      }

      if (!envDetector.isComplete() || (vad && !wasSpeaking)) {
        // 环境检测（录音初期自动分析背景噪声）
        if (!envDetector.isComplete()) {
          const envResult = envDetector.process(samples);
          if (envResult) {
            logger.info('Environment detected', {
              environment: envResult.environment,
              confidence: envResult.confidence,
            });
            vad?.configure(envResult.recommendedVadOptions);
          }
        }

        // VAD 自动停止（仅 arecord，无内置静音检测）
        if (vad) {
          const vadResult = vad.process(samples);
          if (wasSpeaking && !vadResult.isSpeech) {
            logger.info('VAD silence detected, stopping recording');
            this.stopRecording();
            onEnd();
            return;
          }
          if (vadResult.isSpeech) {
            wasSpeaking = true;
          }
          // 边界条件：全程未检测到语音，超过初始静音阈值后自动停止
          if (!vad.hasEverSpoken()) {
            initialSilenceChunks++;
            if (initialSilenceChunks >= MAX_INITIAL_SILENCE_CHUNKS) {
              logger.info(
                'VAD no speech detected from start, stopping recording'
              );
              this.stopRecording();
              onEnd();
              return;
            }
          }
        }
      }

      onData(chunk);
    };

    const method = deps.method as RecordingMethod;
    const started = await this.recorder.startStream(
      method,
      deps.method === 'ffmpeg' || deps.method === 'powershell'
        ? onData
        : wrappedOnData,
      () => {
        this.isRecording = false;
        this.emit('stop');
        onEnd();
      },
      options
    );

    if (!started) {
      this.isRecording = false;
    }
    return started;
  }

  /**
   * 停止录音
   */
  stopRecording(): void {
    if (!this.isRecording) {
      return;
    }

    this.recorder.stop();
    this.isRecording = false;
    this.emit('stop');
  }

  // ===========================================================
  // 文件录音
  // ===========================================================

  /**
   * 开始文件级录音（保存到临时文件，适用于 CLI 命令）
   *
   * @param options 录音选项
   * @param onState 状态回调
   * @returns 录音文件路径
   */
  async startFileRecording(
    options: RecordingOptions = {},
    onState?: RecordingStateHandler
  ): Promise<string> {
    const deps = await this.checkVoiceDependencies();
    if (!deps.available) {
      throw new Error(
        `No recording tool available. Missing: ${deps.missing.join(', ')}. ` +
          `Install: ${deps.installCommand ?? 'See platform documentation'}`
      );
    }

    const method = deps.method as RecordingMethod;
    return await this.recorder.startFile(method, options, onState);
  }

  // ===========================================================
  // 录音文件管理
  // ===========================================================

  /**
   * 读取录音文件
   * @param filePath 录音文件路径
   */
  async getRecording(filePath: string): Promise<RecordingResult> {
    if (!existsSync(filePath)) {
      throw new Error(`Recording file not found: ${filePath}`);
    }

    // 从 WAV 文件头解析实际时长
    const durationMs = readWavDuration(filePath);

    return {
      filePath,
      durationMs,
      sampleRate: this.config.sampleRate ?? RECORDING_SAMPLE_RATE,
      format: 'wav',
    };
  }

  /**
   * 清除录音文件
   * @param filePath 录音文件路径
   */
  async cleanupRecording(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch {
      // 文件不存在时忽略
    }
  }

  // ===========================================================
  // 语音识别
  // ===========================================================

  /**
   * 语音识别（将音频转换为文本）
   *
   * 通过 STTRegistry 选择可用的 STT 提供者执行转录。
   * options 为空时使用默认语言和关键词配置。
   * 若识别结果为空文本，返回 null。
   *
   * @param audioData 音频数据
   * @param options 转录选项
   */
  async recognizeSpeech(
    audioData: Buffer,
    options?: STTTranscribeOptions
  ): Promise<STTResult | null> {
    const result: STTResult = await STTRegistry.transcribe(audioData, {
      ...options,
      language:
        options?.language || this.config.sttLanguage || this.config.language,
      keyterms: options?.keyterms || this.config.sttKeyterms,
    });

    if (!result.text) {
      return null;
    }

    // STT 后处理：文本归一化
    result.text = normalizeText(result.text);

    return result;
  }

  /**
   * 语音识别（简化接口）
   *
   * 调用 recognizeSpeech，空文本时始终返回含空字符串的 STTResult。
   *
   * @param audioData 音频数据
   */
  async recognize(audioData: Buffer): Promise<STTResult> {
    const result = await this.recognizeSpeech(audioData);
    if (!result) {
      return { text: '', confidence: 0, isFinal: true, duration: 0 };
    }
    return {
      ...result,
      text: result.text || '',
      duration: result.duration || 0,
    };
  }

  // ===========================================================
  // 语音合成
  // ===========================================================

  /**
   * 语音合成（将文本转换为语音 Buffer）
   *
   * 默认返回 TTS 提供者的原始音频数据。
   * 如果指定 targetFormat 且 ffmpeg 可用，自动进行格式转换。
   *
   * @param text 文本
   * @param targetFormat 目标音频格式（可选，不指定则返回原始数据）
   */
  async synthesizeSpeech(
    text: string,
    targetFormat?: AudioFormat
  ): Promise<Buffer | null> {
    const result = await TTSRegistry.speak({ text });

    if (!result.success || !result.audioData) {
      return null;
    }

    // 不需要格式转换，直接返回原始音频数据
    if (!targetFormat || targetFormat === 'wav') {
      return result.audioData;
    }

    // 需要格式转换但 ffmpeg 不可用，降级返回原始数据
    if (!isFFmpegAvailable()) {
      logger.warn('synthesizeSpeech · ffmpeg 不可用，返回原始音频');
      return result.audioData;
    }

    const inputExt = result.audioFormat || 'wav';
    const tmpInput = join(tmpdir(), `tts_raw_${randomUUID()}.${inputExt}`);
    const ext = getFormatInfo(targetFormat).extension;
    const tmpOutput = join(tmpdir(), `tts_conv_${randomUUID()}${ext}`);

    try {
      await writeFile(tmpInput, result.audioData);

      const convResult = AudioFormatConverter.convert({
        inputPath: tmpInput,
        outputPath: tmpOutput,
        targetFormat,
      });

      if (convResult.success && convResult.outputPath) {
        return await readFile(convResult.outputPath);
      }

      // 转换失败，降级返回原始数据
      return result.audioData;
    } catch (error) {
      await handleError(error, {
        module: 'services:voice',
        action: 'synthesize_speech_format_conversion',
      });
      return result.audioData;
    } finally {
      try {
        await unlink(tmpInput);
      } catch {
        /* ignore */
      }
      try {
        await unlink(tmpOutput);
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * 语音合成并播放
   *
   * 支持通过 personaId 指定人设，人设中的 voice/speed 可作为默认值，
   * 被 options 中的显式 voice/speed 覆盖。
   *
   * @param options 语音输出选项
   */
  async speak(options: VoiceOutputOptions): Promise<void> {
    this.isSpeaking = true;
    this.emit('start');

    // 解析人设配置（如果指定了 personaId）
    let resolvedVoice = options.voice;
    let resolvedSpeed = options.speed;
    let resolvedProvider: string | undefined;

    if (options.personaId) {
      const persona = TTSPersonaManager.get(options.personaId);
      if (persona) {
        resolvedVoice = options.voice ?? persona.voice;
        resolvedSpeed = options.speed ?? persona.speed;
        resolvedProvider = persona.provider;
      } else {
        logger.warn('VoiceService · 人设不存在', {
          personaId: options.personaId,
        });
      }
    }

    const result = await TTSRegistry.speak(
      {
        text: options.text,
        voice: resolvedVoice,
        speed: resolvedSpeed,
      },
      resolvedProvider
    );

    if (!result.success) {
      this.isSpeaking = false;
      this.emit('error', { error: result.error });
      return;
    }

    this.isSpeaking = false;
    this.emit('stop');
  }

  /**
   * 停止语音输出
   */
  stopSpeaking(): void {
    if (!this.isSpeaking) {
      return;
    }
    TTSRegistry.stopAll();
    this.isSpeaking = false;
    this.emit('stop');
  }

  // ===========================================================
  // 辅助功能
  // ===========================================================

  /**
   * 获取当前音量级别（归一化值 0-1）
   *
   * 录音时实时从 AudioLevelMeter 读取；非录音状态返回 0。
   */
  getVolumeLevel(): number {
    return this.currentLevel;
  }

  /**
   * 获取支持的语言
   */
  getSupportedLanguages(): Array<{ code: string; name: string }> {
    return [
      { code: 'zh-CN', name: 'Chinese (Mandarin)' },
      { code: 'en-US', name: 'English (US)' },
      { code: 'en-GB', name: 'English (UK)' },
      { code: 'ja-JP', name: 'Japanese' },
      { code: 'ko-KR', name: 'Korean' },
      { code: 'fr-FR', name: 'French' },
      { code: 'de-DE', name: 'German' },
      { code: 'es-ES', name: 'Spanish' },
    ];
  }

  // ===========================================================
  // 生命周期
  // ===========================================================

  /**
   * 销毁服务，释放所有资源
   */
  destroy(): void {
    this.stopRecording();
    this.stopSpeaking();
    this.listeners.clear();
  }
}

/**
 * 创建语音服务实例
 * @param config 语音服务配置
 */
export function createVoiceService(
  config: VoiceServiceConfig = {}
): VoiceService {
  return new VoiceService(config);
}

// 导出默认服务实例
const voiceService = createVoiceService();
export default voiceService;
