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
import { Logger, getOTelTracing } from '@modules/monitoring';
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
import type { TTSSpeakResult } from './ttsProvider';
import { STTRegistry } from './sttRegistry';
import { TTSPersonaManager } from './ttsPersonaManager';
import { AudioLevelMeter } from './audioLevelMeter';
import {
  AudioFormatConverter,
  isFFmpegAvailable,
  getFormatInfo,
} from './audioFormatConverter';
import { AudioPipeline } from './audioPipeline';
import type { AudioPreprocessOptions } from './audioPipeline';
import { pcm16BufferToSamples } from './audioUtils';
import type { AudioFormat } from './audioFormatConverter';
import { Recorder, type RecordingMethod } from './recorder';
import { TTSMetricsCollector, MetricsHook } from './metrics';
import { PlaybackManager } from './playbackManager';
import {
  checkVoiceDependencies,
  checkRecordingAvailability,
  RECORDING_SAMPLE_RATE,
  RECORDING_CHANNELS,
  RECORDING_BITS_PER_SAMPLE,
  SILENCE_DURATION_SECS,
  SILENCE_THRESHOLD,
} from './recordingDetector';

const logger = new Logger({ module: 'voice:service' });

/**
 * 日志采样配置（方案 17）
 *
 * 按级别定义采样率，ERROR 全采样，DEBUG 仅 1%，避免日志过多。
 */
const SAMPLE_RATES: Record<string, number> = {
  error: 1.0,
  warn: 0.2,
  info: 0.05,
  debug: 0.01,
};

/** 关键事件列表：这些事件即使 INFO 级别也跳过采样（方案 17） */
const CRITICAL_EVENTS = new Set([
  'VoiceService',
  '熔断器',
  '故障转移',
  'Provider 切换',
]);

/**
 * shouldSample — 判断是否应该记录日志（方案 17）
 *
 * @param level 日志级别
 * @param message 日志消息（用于匹配关键事件）
 * @returns true 表示应该记录
 */
function shouldSample(level: string, message?: string): boolean {
  if (message && CRITICAL_EVENTS.has(message)) return true;
  const rate = SAMPLE_RATES[level] ?? 1.0;
  return Math.random() < rate;
}

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
  } catch (err) {
    return 0;
  }
}

// ---------------------------------------------------------------
// 重试与退避策略（方案 3）
// ---------------------------------------------------------------

/** 错误分类 */
type ErrorCategory = 'retryable' | 'non_retryable' | 'unknown';

/** 重试选项 */
interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/**
 * 错误分类
 *
 * 4xx（客户端错误）→ non_retryable，不重试
 * 5xx/超时/断网 → retryable，自动重试
 * 未知错误保守处理：返回 retryable
 */
function categorizeError(error: unknown, provider: string): ErrorCategory {
  const msg = String(error);

  // 不可重试：4xx、认证失败、参数错误
  if (msg.includes('401') || msg.includes('403') || msg.includes('invalid')) {
    return 'non_retryable';
  }
  if (msg.includes('bad request') || msg.includes('not found')) {
    return 'non_retryable';
  }

  // 可重试：5xx、超时、连接断开、WebSocket 断开
  if (msg.includes('500') || msg.includes('502') || msg.includes('503')) {
    return 'retryable';
  }
  if (
    msg.includes('timeout') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNRESET')
  ) {
    return 'retryable';
  }
  if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
    return 'retryable';
  }
  if (msg.includes('WebSocket closed') || msg.includes('socket')) {
    return 'retryable';
  }

  logger.warn('未知错误分类', { provider, error: msg });
  return 'retryable'; // 保守策略：未知错误也重试
}

/**
 * 指数退避重试
 *
 * @param fn 要重试的异步函数
 * @param provider Provider 名称（用于日志）
 * @param options 重试选项
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  provider: string,
  options: RetryOptions = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10_000,
  }
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const category = categorizeError(error, provider);

      if (category === 'non_retryable') {
        throw error; // 不重试，直接抛出
      }

      if (attempt < options.maxRetries) {
        const delay = Math.min(
          options.baseDelayMs * Math.pow(2, attempt),
          options.maxDelayMs
        );
        logger.warn('TTS 请求重试', {
          provider,
          attempt: attempt + 1,
          maxRetries: options.maxRetries,
          delay,
          error: String(error),
        });
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------
// 内部类型
// ---------------------------------------------------------------

/** Speak 队列任务 */
interface SpeakTask {
  id: string;
  options: VoiceOutputOptions;
  resolve: (result: boolean) => void;
  reject: (error: unknown) => void;
}

/**
 * TTS 熔断器（方案 4）
 *
 * 连续失败 N 次 → 熔断打开 → 熔断 N 秒 → 半开 → 试探成功则关闭。
 */
class CircuitBreaker {
  private state: 'closed' | 'open' | 'half_open' = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;

  constructor(
    private readonly threshold = 5,
    private readonly openTimeoutMs = 30_000,
    private readonly halfOpenMax = 3
  ) {}

  /** 检查是否允许请求通过 */
  allowRequest(): boolean {
    if (this.state === 'closed') return true;

    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.openTimeoutMs) {
        this.state = 'half_open';
        this.failureCount = 0;
        return true;
      }
      return false;
    }

    // half_open：限制并发试探次数
    return this.failureCount < this.halfOpenMax;
  }

  /** 记录成功 */
  onSuccess(): void {
    if (this.state === 'half_open') {
      this.state = 'closed';
      this.failureCount = 0;
    }
  }

  /** 记录失败 */
  onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'closed' && this.failureCount >= this.threshold) {
      this.state = 'open';
      logger.warn('TTS 熔断器打开', {
        threshold: this.threshold,
        openTimeoutMs: this.openTimeoutMs,
      });
    }

    if (this.state === 'half_open' && this.failureCount >= this.halfOpenMax) {
      this.state = 'open';
      this.lastFailureTime = Date.now();
    }
  }

  /** 获取当前状态 */
  getState(): 'closed' | 'open' | 'half_open' {
    return this.state;
  }

  /** 重置熔断器 */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
  }
}

// ---------------------------------------------------------------
// TTS 输出 LRU 缓存（方案 11：去重 + 缓存）
// ---------------------------------------------------------------

/** LRU 缓存节点 */
interface LRUNode {
  key: string;
  value: Buffer;
  prev: LRUNode | null;
  next: LRUNode | null;
}

/**
 * TTSCache — TTS 音频输出 LRU 缓存
 *
 * 缓存 TTS 合成结果（PCM16 Buffer），避免相同文本重复合成。
 * 使用双向链表实现 LRU 淘汰策略，最多缓存 maxSize 条。
 * 缓存键为 text + voice + speed 拼接，确保粒度精准。
 *
 * @example
 *   const ttsCache = new TTSCache(50);
 *   const key = ttsCache.makeKey('你好', 'zh-CN-XiaoxiaoNeural', 1.0);
 *   ttsCache.set(key, pcmBuffer);
 *   const cached = ttsCache.get(key);
 */
class TTSCache {
  private maxSize: number;
  private map = new Map<string, LRUNode>();
  private head: LRUNode | null = null;
  private tail: LRUNode | null = null;

  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }

  /**
   * 构建缓存键
   *
   * @param text TTS 文本
   * @param voice 语音 ID
   * @param speed 语速
   * @returns 缓存键字符串
   */
  static makeKey(text: string, voice?: string, speed?: number): string {
    return `${voice || ''}|${speed ?? 1.0}|${text}`;
  }

  /**
   * 获取缓存
   *
   * @param key 缓存键
   * @returns PCM16 Buffer，或 undefined（未命中）
   */
  get(key: string): Buffer | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;

    // 移到链表头（最近使用）
    this.moveToHead(node);
    return node.value;
  }

  /**
   * 写入缓存
   *
   * @param key 缓存键
   * @param value PCM16 Buffer
   */
  set(key: string, value: Buffer): void {
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      this.moveToHead(existing);
      return;
    }

    // 淘汰最久未使用的条目
    if (this.map.size >= this.maxSize) {
      this.evictTail();
    }

    const node: LRUNode = {
      key,
      value,
      prev: null,
      next: this.head,
    };

    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;
    if (!this.tail) {
      this.tail = node;
    }

    this.map.set(key, node);
  }

  /**
   * 主动失效指定 key
   *
   * @param key 缓存键
   */
  delete(key: string): void {
    const node = this.map.get(key);
    if (!node) return;

    this.removeNode(node);
    this.map.delete(key);
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.map.clear();
    this.head = null;
    this.tail = null;
  }

  /**
   * 当前缓存大小
   */
  get size(): number {
    return this.map.size;
  }

  /** 将节点移到链表头 */
  private moveToHead(node: LRUNode): void {
    if (node === this.head) return;
    this.removeNode(node);

    node.next = this.head;
    node.prev = null;
    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;
    if (!this.tail) {
      this.tail = node;
    }
  }

  /** 移除节点 */
  private removeNode(node: LRUNode): void {
    if (node.prev) {
      node.prev.next = node.next;
    }
    if (node.next) {
      node.next.prev = node.prev;
    }
    if (node === this.head) {
      this.head = node.next;
    }
    if (node === this.tail) {
      this.tail = node.prev;
    }
  }

  /** 淘汰尾节点 */
  private evictTail(): void {
    if (!this.tail) return;
    this.map.delete(this.tail.key);
    this.removeNode(this.tail);
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
  /** 音频播放管理器（方案 B） */
  private playbackManager: PlaybackManager;
  /** Speak 串行队列 */
  private speakQueue: SpeakTask[] = [];
  /** 队列是否正在处理中 */
  private isProcessingQueue = false;
  /** 熔断器（按 Provider 名索引） */
  private breakers = new Map<string, CircuitBreaker>();
  /** TTS 输出 LRU 缓存（方案 11） */
  private ttsCache: TTSCache;
  /** TTS 配置版本号（方案 13） */
  private configVersion: number = 0;
  /** 当前合成操作的 AbortController（方案 15） */
  private speakAbortController: AbortController | null = null;
  /** TTS 性能指标采集器（方案 21） */
  private metricsCollector: TTSMetricsCollector;

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

    this.playbackManager = new PlaybackManager({
      sampleRate: this.config.sampleRate ?? RECORDING_SAMPLE_RATE,
      channels: 1,
      bitsPerSample: 16,
    });

    // 转发播放事件到 VoiceService 事件系统
    this.playbackManager.onEvent = (event, data) => {
      this.emit(event as import('../models/types').VoiceEventType, data);
    };

    this.ttsCache = new TTSCache(50);
    this.metricsCollector = new TTSMetricsCollector();
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
   *
   * 方案 13：配置更新时递增版本号并发射 config:tts:changed 事件。
   * 事件体包含 version，监听方可据此判断是否需要刷新。
   */
  updateConfig(config: Partial<VoiceServiceConfig>): void {
    this.config = { ...this.config, ...config };
    this.configVersion++;
    this.emit('config:tts:changed', {
      version: this.configVersion,
      timestamp: Date.now(),
    });
  }

  /**
   * 获取当前 TTS 配置版本号（方案 13）
   * 监听 config:tts:changed 事件的消费者可通过版本号判断是否需要刷新。
   */
  getConfigVersion(): number {
    return this.configVersion;
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
    } catch (err) {
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
   * 在转录前对音频进行前处理（噪声门控、音量归一化、静音裁剪），
   * 以提高识别准确率。前处理失败时自动降级为原始音频。
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
    // STT 音频前处理：噪声门控 + 音量归一化 + 静音裁剪
    let processedAudio = audioData;
    try {
      const pipeline = AudioPipeline.fromBuffer(audioData);
      const sttBuffer = await pipeline.preprocessForSTT();
      processedAudio = sttBuffer.data;
      logger.info('STT 音频前处理完成', {
        inputSize: audioData.length,
        outputSize: processedAudio.length,
      });
    } catch (preprocessError) {
      logger.warn('STT 音频前处理失败，使用原始音频', {
        error:
          preprocessError instanceof Error
            ? preprocessError.message
            : String(preprocessError),
      });
      // 前处理失败不影响主路径 — CS03 回退最小化
    }

    const result: STTResult = await STTRegistry.transcribe(processedAudio, {
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
    const otel = getOTelTracing();
    return otel.wrap(
      {
        name: 'voice.service.synthesizeSpeech',
        attributes: {
          textLength: text.length,
          targetFormat: targetFormat ?? 'wav',
        },
      },
      async () => {
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
          } catch (err) {
            /* ignore */
          }
          try {
            await unlink(tmpOutput);
          } catch (err) {
            /* ignore */
          }
        }
      }
    )();
  }

  /**
   * 播放已合成的音频
   *
   * 委托给 PlaybackManager 处理格式转换和播放。
   *
   * @param result TTS 合成结果
   */
  private async playSynthesizedAudio(result: TTSSpeakResult): Promise<void> {
    await this.playbackManager.play(
      result.audioData ?? Buffer.alloc(0),
      result.audioFormat
    );
  }

  /**
   * 将 TTS 文本按边界切分为块
   *
   * 分片规则：800 字符/块，按 `。！？；\n\n` 切分，
   * 超长块在最后标点处二次切分。
   * 100 字以下不分片。
   */
  private static chunkTextForTTS(text: string): string[] {
    if (text.length <= 100) return [text];

    const SENTENCE_BOUNDARY = /[。！？；\n\n]/;
    const MAX_CHUNK_SIZE = 800;
    const chunks: string[] = [];

    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + MAX_CHUNK_SIZE, text.length);

      if (end < text.length) {
        // 从 end 向前找边界标点
        let boundary = -1;
        for (let i = end; i > start; i--) {
          if (SENTENCE_BOUNDARY.test(text[i - 1])) {
            boundary = i;
            break;
          }
        }
        if (boundary > start) {
          end = boundary;
        }
      }

      chunks.push(text.slice(start, end).trim());
      start = end;
    }

    return chunks.filter((c) => c.length > 0);
  }

  /**
   * 入队 speak 任务并返回 Promise
   *
   * 如果文本超过 100 字符，自动分片后为每片创建独立的队列任务。
   * 返回的 Promise 在所有分片完成后 resolve(true)，
   * 任一任务 reject 不阻塞后续任务（方案 5 队列容错）。
   *
   * 方案 15：分片循环发射 progress 事件（{ current, total }），
   * 支持通过 AbortSignal 中断。
   */
  async speak(options: VoiceOutputOptions): Promise<void> {
    const otel = getOTelTracing();
    return otel.wrap(
      {
        name: 'voice.service.speak',
        attributes: {
          textLength: options.text.length,
          hasPersona: !!options.personaId,
          voice: options.voice ?? 'default',
        },
      },
      async () => {
        // 方案 15：创建新的 AbortController
        const abortController = new AbortController();
        this.speakAbortController = abortController;

        return new Promise<void>((resolve, reject) => {
          const chunks = VoiceService.chunkTextForTTS(options.text);
          let completedCount = 0;
          let hasError = false;

          for (const chunk of chunks) {
            const task: SpeakTask = {
              id: randomUUID(),
              options: { ...options, text: chunk },
              resolve: () => {
                completedCount++;
                // 方案 15：每次分片完成后发射 progress 事件
                this.emit('progress', {
                  current: completedCount,
                  total: chunks.length,
                  chunk,
                });
                if (completedCount === chunks.length) {
                  resolve();
                }
              },
              reject: (error) => {
                if (!hasError) {
                  hasError = true;
                  reject(error);
                }
                // 已 reject 的任务不再影响队列（方案 5：单个任务失败不阻塞后续）
              },
            };
            this.speakQueue.push(task);
          }

          this.emit('start', { totalChunks: chunks.length });
          this.processQueue();
        }).finally(() => {
          // 方案 15：清除 AbortController
          if (this.speakAbortController === abortController) {
            this.speakAbortController = null;
          }
        });
      }
    )();
  }

  /**
   * 串行处理 speak 队列
   *
   * 每个任务用 try/catch 包裹（方案 5 队列容错），
   * 单个任务失败只记录日志，不阻塞后续任务。
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.speakQueue.length === 0) return;
    this.isProcessingQueue = true;

    while (this.speakQueue.length > 0) {
      const task = this.speakQueue.shift()!;

      try {
        await this.executeSpeakTask(task);
        task.resolve(true);
      } catch (error) {
        // 方案 5：单个任务失败不阻塞队列
        void handleError(error, {
          module: 'services:voice',
          action: 'speak 任务执行失败',
          context: { taskId: task.id },
        });
        task.reject(error);
        // 继续处理下一个任务
      }
    }

    this.isProcessingQueue = false;
    this.emit('queue_drained');
  }

  /**
   * 执行单个 speak 任务
   * 包含人设解析 → TTS 合成 → PCM 播放
   * 含 LRU 缓存（方案 11）和 TTS 配置版本号（方案 13）
   */
  private async executeSpeakTask(task: SpeakTask): Promise<void> {
    const options = task.options;

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

    const providerName = resolvedProvider ?? 'unknown';

    // 熔断器检查 + 自动故障转移（方案 4 + 方案 24）
    const breaker = this.getBreaker(providerName);
    if (!breaker.allowRequest()) {
      logger.warn('VoiceService · 熔断器已打开，执行故障转移', {
        provider: providerName,
        breakerState: breaker.getState(),
      });
      try {
        const fallbackProvider = this.selectProviderWithFallback(providerName);
        if (fallbackProvider !== providerName) {
          logger.warn('VoiceService · 自动切换到备用 Provider', {
            primary: providerName,
            fallback: fallbackProvider,
          });
          return this.executeWithProvider(task, fallbackProvider);
        }
      } catch (err) {
        // selectProviderWithFallback 已抛出明确错误
      }
      throw new Error(
        `TTS 熔断器已打开（${providerName}），所有 Provider 均不可用`
      );
    }

    return this.executeWithProvider(task, providerName);
  }

  /**
   * executeWithProvider — 用指定 Provider 执行 speak 任务（方案 24）
   *
   * 封装 TTS 合成 + 缓存 + 播放逻辑，供 executeSpeakTask 和故障转移调用。
   * 方案 21：在合成和播放前后添加 metrics 埋点。
   */
  private async executeWithProvider(
    task: SpeakTask,
    providerName: string
  ): Promise<void> {
    const options = task.options;

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

    // LRU 缓存检查（方案 11）：相同文本+语音+语速跳过重复合成
    const cacheKey = TTSCache.makeKey(
      options.text,
      resolvedVoice,
      resolvedSpeed
    );
    const cachedData = this.ttsCache.get(cacheKey);

    // 缓存击中 → 直接播放，跳过 TTS 合成
    if (cachedData) {
      if (shouldSample('debug', 'VoiceService')) {
        logger.debug('VoiceService · TTS 缓存命中', { cacheKey });
      }
      const cachedResult: TTSSpeakResult = {
        success: true,
        audioData: cachedData,
      };
      return this.playSynthesizedAudio(cachedResult);
    }

    // 方案 21：TTS 合成开始埋点
    this.metricsCollector.startHook(MetricsHook.TTS_SYNTHESIS, {
      provider: providerName,
      textLength: options.text.length,
      voice: resolvedVoice,
    });

    const synthesisStartTime = Date.now();

    const result = await withRetry(
      () =>
        TTSRegistry.speak(
          {
            text: options.text,
            voice: resolvedVoice,
            speed: resolvedSpeed,
          },
          providerName
        ),
      providerName
    );

    const synthesisLatency = Date.now() - synthesisStartTime;

    // 方案 21：TTS 合成结束埋点
    this.metricsCollector.endHook(MetricsHook.TTS_SYNTHESIS);

    if (!result.success) {
      this.getBreaker(providerName).onFailure();
      this.recordProviderResult(providerName, false, synthesisLatency); // 方案 24
      // 方案 21：记录 Provider 失败
      this.metricsCollector.recordProviderResult(providerName, false);
      throw new Error(result.error ?? 'TTS 合成失败');
    }

    // 合成成功，通知熔断器
    this.getBreaker(providerName).onSuccess();
    this.recordProviderResult(providerName, true, synthesisLatency); // 方案 24
    // 方案 21：记录 Provider 成功
    this.metricsCollector.recordProviderResult(providerName, true);

    // 将合成结果写入缓存（方案 11）
    if (result.audioData) {
      this.ttsCache.set(cacheKey, result.audioData);
    }

    // 将合成音频送入 PCMAudioPlayer 播放
    await this.playSynthesizedAudio(result);
  }

  /**
   * 停止语音输出
   *
   * 清空待处理队列并停止当前播放
   * 方案 15：调用 AbortController.abort() 中断底层合成操作
   */
  stopSpeaking(): void {
    // 方案 15：中断正在进行的合成
    if (this.speakAbortController) {
      this.speakAbortController.abort();
      this.speakAbortController = null;
    }

    // 清空所有待处理队列任务
    const pendingTasks = this.speakQueue.splice(0);
    for (const task of pendingTasks) {
      task.reject(new Error('语音输出已被用户停止'));
    }
    this.isProcessingQueue = false;

    TTSRegistry.stopAll();
    this.isSpeaking = false;
    this.emit('stop');
  }

  /**
   * 获取指定 Provider 的熔断器，不存在则创建
   */
  private getBreaker(provider: string): CircuitBreaker {
    if (!this.breakers.has(provider)) {
      this.breakers.set(provider, new CircuitBreaker());
    }
    return this.breakers.get(provider)!;
  }

  /**
   * 手动重置指定 Provider 的熔断器
   */
  resetBreaker(provider: string): void {
    const breaker = this.breakers.get(provider);
    if (breaker) {
      breaker.reset();
      logger.info('VoiceService · 熔断器已手动重置', { provider });
    }
  }

  // ===========================================================
  // 焦点去抖（方案 10）
  // ===========================================================

  /** 当前活跃的 speak 文本 → AbortController 映射（方案 10） */
  private pendingSpeaks = new Map<string, AbortController>();

  /**
   * speakText — 带焦点去抖的 TTS 播报（方案 10）
   *
   * 多个 UI 页面同时触发相同文本的 TTS 时，自动取消重复请求。
   * 最后一次请求有效（类似 debounce），避免多个 tab 同时播放。
   *
   * @param text 播报文本
   * @param options 播报选项
   */
  async speakText(
    text: string,
    options?: Partial<VoiceOutputOptions>
  ): Promise<void> {
    // 如果已有相同文本在播报中，取消之前的请求
    const existing = this.pendingSpeaks.get(text);
    if (existing) {
      existing.abort();
      this.pendingSpeaks.delete(text);
    }

    const controller = new AbortController();
    this.pendingSpeaks.set(text, controller);

    try {
      await this.speak({
        text,
        voice: options?.voice,
        speed: options?.speed,
        personaId: options?.personaId,
      });
    } finally {
      this.pendingSpeaks.delete(text);
    }
  }

  // ===========================================================
  // Provider 故障转移（方案 24）
  // ===========================================================

  /** Provider 健康评分（方案 24） */
  private providerHealth = new Map<
    string,
    {
      success: number;
      failure: number;
      lastFailTime: number;
      totalLatency: number;
      callCount: number;
    }
  >();

  /**
   * recordProviderResult — 记录 Provider 调用结果（方案 24）
   *
   * 用于故障转移评分：连续失败超过阈值时标记为不可用，
   * 自动切换到评分最高的 Provider。
   *
   * @param provider Provider 名
   * @param success 是否成功
   * @param latencyMs 本次调用耗时（ms），用于计算平均延迟
   */
  private recordProviderResult(
    provider: string,
    success: boolean,
    latencyMs?: number
  ): void {
    const record = this.providerHealth.get(provider) ?? {
      success: 0,
      failure: 0,
      lastFailTime: 0,
      totalLatency: 0,
      callCount: 0,
    };
    if (success) {
      record.success++;
      record.failure = 0;
    } else {
      record.failure++;
      record.lastFailTime = Date.now();
    }
    if (latencyMs !== undefined) {
      record.totalLatency += latencyMs;
      record.callCount++;
    }
    this.providerHealth.set(provider, record);
  }

  /**
   * getProviderHealth — 获取指定 Provider 的当前健康状态（方案 24）
   *
   * 对外暴露熔断器状态、失败率、平均延迟和综合健康评分。
   * 供 TTSRegistry、监控面板或外部模块使用。
   *
   * @param name Provider 名
   * @returns Provider 健康状态，若 Provider 不存在返回 null
   */
  getProviderHealth(
    name: string
  ): import('../models/types').ProviderHealth | null {
    const breaker = this.breakers.get(name);
    const record = this.providerHealth.get(name);

    if (!breaker && !record) return null;

    const failureRate = record
      ? record.success + record.failure > 0
        ? record.failure / (record.success + record.failure)
        : 0
      : 0;
    const avgLatency =
      record && record.callCount > 0
        ? Math.round(record.totalLatency / record.callCount)
        : 0;

    // 假设熔断器正常（closed），若不存在该 Provider 的熔断器
    const circuitState = breaker ? breaker.getState() : ('closed' as const);
    const score = this.calculateHealthScore(
      circuitState,
      failureRate,
      avgLatency
    );

    return { providerName: name, circuitState, failureRate, avgLatency, score };
  }

  /**
   * calculateHealthScore — 计算 Provider 健康评分（方案 24）
   *
   * 加权计算公式：
   *   - circuitScore（50%）：熔断器状态分
   *   - failureScore（30%）：失败率分
   *   - latencyScore（20%）：延迟分
   *
   * @param circuitState 熔断器状态
   * @param failureRate 失败率（0-1）
   * @param avgLatency 平均延迟（ms）
   * @returns 健康评分（0-100，越高越健康）
   */
  private calculateHealthScore(
    circuitState: 'closed' | 'open' | 'half_open',
    failureRate: number,
    avgLatency: number
  ): number {
    // 熔断器状态分：closed=100, half_open=40, open=0
    const circuitScore =
      circuitState === 'closed' ? 100 : circuitState === 'half_open' ? 40 : 0;

    // 失败率分：failureRate=0 → 100, failureRate=1 → 0
    const failureScore = Math.max(0, 100 - failureRate * 100);

    // 延迟分：<= 500ms → 100, >= 5000ms → 0，中间线性衰减
    const latencyScore =
      avgLatency <= 500
        ? 100
        : avgLatency >= 5000
          ? 0
          : Math.max(0, 100 - (avgLatency - 500) / 45);

    return Math.round(
      circuitScore * 0.5 + failureScore * 0.3 + latencyScore * 0.2
    );
  }

  /**
   * selectProviderWithFallback — 选择最佳可用 Provider，自动故障转移（方案 24）
   *
   * 优先使用 preferred Provider，若熔断则按健康评分降级到次优 Provider。
   * 当前实现从 pickBestByHealth 中循环检查所有已注册 Provider，
   * 跳过评分 <= 0 的不可用 Provider。如果全部不可用则抛出错误。
   *
   * @param preferredProvider 优先选择的 Provider 名（可选）
   * @returns 最佳可用 Provider 名
   * @throws 若所有 Provider 都不可用
   */
  selectProviderWithFallback(preferredProvider?: string): string {
    const providers = TTSRegistry.getProviderNames();

    if (providers.length === 0) {
      throw new Error('TTS · 没有已注册的 Provider，无法进行语音合成');
    }

    // 按健康评分降序排序
    const scored = providers
      .map((name) => ({ name, health: this.getProviderHealth(name) }))
      .filter(
        (
          entry
        ): entry is {
          name: string;
          health: import('../models/types').ProviderHealth;
        } => entry.health !== null
      )
      .sort((a, b) => b.health.score - a.health.score);

    // 如果指定了优先 Provider 且可用（评分 > 0），直接使用
    if (preferredProvider) {
      const preferred = scored.find((s) => s.name === preferredProvider);
      if (preferred && preferred.health.score > 0) {
        return preferredProvider;
      }
    }

    // 从评分最高者中选择第一个评分 > 0 的
    const available = scored.find((s) => s.health.score > 0);
    if (available) return available.name;

    // 所有 Provider 都不可用
    throw new Error('TTS · 所有 Provider 均不可用，无法进行语音合成');
  }

  // ===========================================================
  // 性能可观测性（方案 18 + 21）
  // ===========================================================

  /**
   * getSnapshot — 获取 TTS 性能快照（方案 18）
   *
   * 返回当前 Provider 健康评分、各埋点平均耗时、P95 耗时。
   * 可用于监控面板展示或周期性健康检查。
   *
   * @returns 性能快照
   */
  getMetricsSnapshot(): import('./metrics').TTSMetricsSnapshot {
    return this.metricsCollector.getSnapshot();
  }

  /**
   * getMetricsCollector — 获取指标采集器实例（方案 21）
   *
   * 供外部模块（如监控面板）直接访问采集器。
   */
  getMetricsCollector(): TTSMetricsCollector {
    return this.metricsCollector;
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
    this.playbackManager.destroy();
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
