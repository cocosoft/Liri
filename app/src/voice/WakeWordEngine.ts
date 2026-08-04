/**
 * WakeWordEngine — 唤醒词引擎
 *
 * 基于 VAD（语音活动检测）+ LocalSTT 热词方案的轻量级唤醒词检测引擎。
 * 零第三方依赖，复用现有 VadDetector 和 STTRegistry。
 *
 * 工作流程：
 * 1. 外部（WebSocket / HTTP stream）持续向 `feedAudio()` 送入音频 PCM 样本
 * 2. VadDetector 内部检测语音活动，非语音段不启动 STT
 * 3. 检测到语音段结束后，将语音片段送入 STTRegistry.transcribe() 并传入唤醒词作为 keyterms
 * 4. 回调通知唤醒检测结果
 *
 * 用法：
 * ```ts
 * const engine = new WakeWordEngine({ triggers: ['小鸟小鸟', 'Hi Liri'] });
 * await engine.initialize();
 * engine.onWake = (result) => { ... };
 *
 * // 持续送入音频
 * engine.feedAudio(float32Samples);
 *
 * // 停止
 * engine.destroy();
 * ```
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import { VadDetector } from '@modules/services/voice/services/vadDetector';
import { STTRegistry } from '@modules/services/voice/services/sttRegistry';

const logger = new Logger({ module: 'voice:wakeWord', level: LogLevel.INFO });

/** 唤醒检测回调结果 */
export interface WakeWordResult {
  /** 是否检测到唤醒词 */
  detected: boolean;
  /** 匹配的唤醒词 */
  matchedTrigger: string | null;
  /** 去除唤醒词后的剩余文本 */
  remainingText: string | null;
  /** STT 原始转写文本 */
  transcript: string;
  /** VAD 语音段持续时间（秒） */
  speechDuration: number;
}

/** 唤醒词引擎配置 */
export interface WakeWordEngineConfig {
  /** 唤醒词列表（默认 ["小鸟小鸟"、"Hi Liri"]） */
  triggers?: string[];
  /** 语音段结束后静默保持时间（ms，默认 500） */
  silenceHoldMs?: number;
  /** 最小语音段长度（ms，低于此值不启动 STT，默认 200） */
  minSpeechDurationMs?: number;
  /** 语音段最大长度（ms，超过后强制截断，默认 8000） */
  maxSpeechDurationMs?: number;
  /** STT 语言（默认 "zh-CN"） */
  language?: string;
  /** 采样率（默认 16000） */
  sampleRate?: number;
}

/** 唤醒词引擎状态 */
export type WakeWordEngineStatus =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'destroyed';

/**
 * WakeWordEngine — 唤醒词检测引擎
 *
 * 基于 VAD + LocalSTT 热词方案，无第三方依赖。
 */
export class WakeWordEngine {
  /** 唤醒词列表 */
  private triggers: string[];
  /** VAD 检测器 */
  private vad: VadDetector;
  /** 语音片段累积缓冲区 */
  private speechBuffer: Float64Array = new Float64Array(0);
  /** 语音段开始时间戳 */
  private speechStartMs: number = 0;
  /** 当前引擎状态 */
  private _status: WakeWordEngineStatus = 'idle';
  /** 采样率 */
  private readonly sampleRate: number;
  /** STT 语言 */
  private readonly language: string;
  /** 最大语音段长度（样本数） */
  private readonly maxSpeechSamples: number;
  /** 最小语音段长度（样本数） */
  private readonly minSpeechSamples: number;

  /** 唤醒检测回调 */
  public onWake: ((result: WakeWordResult) => void) | null = null;

  /**
   * @param config 引擎配置
   */
  constructor(config: WakeWordEngineConfig = {}) {
    const silenceHoldMs = config.silenceHoldMs ?? 500;
    const minSpeechDurationMs = config.minSpeechDurationMs ?? 200;
    const maxSpeechDurationMs = config.maxSpeechDurationMs ?? 8000;
    this.sampleRate = config.sampleRate ?? 16000;
    this.language = config.language ?? 'zh-CN';
    this.triggers = config.triggers ?? ['小鸟小鸟', 'Hi Liri'];

    this.vad = new VadDetector(this.sampleRate, {
      silenceHoldMs,
      minSpeechDurationMs,
      frameSize: 480, // 30ms @ 16kHz
    });

    this.maxSpeechSamples = Math.floor(
      (this.sampleRate * maxSpeechDurationMs) / 1000
    );
    this.minSpeechSamples = Math.floor(
      (this.sampleRate * minSpeechDurationMs) / 1000
    );
  }

  /** 当前引擎状态 */
  get status(): WakeWordEngineStatus {
    return this._status;
  }

  /** 唤醒词列表（只读副本） */
  get triggerKeywords(): readonly string[] {
    return [...this.triggers];
  }

  /**
   * 初始化引擎
   * 预置状态，准备接收音频数据
   */
  async initialize(): Promise<void> {
    this.vad.reset();
    this.speechBuffer = new Float64Array(0);
    this.speechStartMs = 0;
    this._status = 'listening';
    logger.info('唤醒引擎已就绪', { triggers: this.triggers });
  }

  /**
   * 送入音频 PCM 样本，驱动 VAD 检测和唤醒词匹配
   *
   * @param samples 归一化 PCM 样本（Float32Array，范围 [-1, 1]）
   */
  feedAudio(samples: Float32Array): void {
    if (this._status !== 'listening') return;

    const float64Samples = new Float64Array(samples);
    const result = this.vad.process(float64Samples);

    if (result.isSpeech) {
      // 语音段开始
      if (this.speechBuffer.length === 0) {
        this.speechStartMs = Date.now();
      }
      // 累积到缓冲区，超长则强制截断
      if (this.speechBuffer.length < this.maxSpeechSamples) {
        this.speechBuffer = this.concatFloat64(
          this.speechBuffer,
          float64Samples
        );
        if (this.speechBuffer.length >= this.maxSpeechSamples) {
          // 达到最大长度，立即处理
          this.flushSpeechSegment();
        }
      }
    } else if (this.speechBuffer.length > 0) {
      // 语音段结束，处理累积的语音片段
      this.flushSpeechSegment();
    }
  }

  /**
   * 处理累积的语音片段：送入 STT 并匹配唤醒词
   */
  private async flushSpeechSegment(): Promise<void> {
    if (this.speechBuffer.length < this.minSpeechSamples) {
      // 太短，丢弃
      this.speechBuffer = new Float64Array(0);
      return;
    }

    this._status = 'processing';

    const speechDuration = (this.speechBuffer.length / this.sampleRate) * 1000;
    const audioBuffer = this.float64ToBuffer(this.speechBuffer);
    const transcript = await this.transcribeWithKeyterms(audioBuffer);

    const normalizedTranscript = transcript.trim().toLowerCase();
    const matched = this.matchWakeWord(normalizedTranscript);

    if (matched.detected) {
      logger.info('唤醒词检测成功', {
        trigger: matched.matchedTrigger,
        transcript,
        durationMs: Math.round(speechDuration),
      });

      this.onWake?.({
        detected: true,
        matchedTrigger: matched.matchedTrigger,
        remainingText: null, // 由 VoiceWakeManager.detectWakeWord() 补全
        transcript,
        speechDuration: speechDuration / 1000,
      });
    } else {
      logger.debug('语音段未匹配唤醒词', { transcript });
    }

    // 重置语音缓冲区并回到监听状态
    this.speechBuffer = new Float64Array(0);
    this._status = 'listening';
  }

  /**
   * 将语音片段送入 STT 并传入唤醒词作为 keyterms
   */
  private async transcribeWithKeyterms(audioBuffer: Buffer): Promise<string> {
    try {
      const result = await STTRegistry.transcribe(audioBuffer, {
        language: this.language,
        keyterms: this.triggers,
      });
      return result.text ?? '';
    } catch (err) {
      void handleError(err, { module: 'voice:wakeword', action: 'transcribe' });
      logger.warn('唤醒引擎 · STT 转录失败（静默降级）', {
        error: String(err),
      });
      return '';
    }
  }

  /**
   * 在转录文本中匹配唤醒词
   * 按长度降序匹配，优先匹配较长唤醒词
   */
  private matchWakeWord(normalizedTranscript: string): {
    detected: boolean;
    matchedTrigger: string | null;
  } {
    const sorted = [...this.triggers].sort((a, b) => b.length - a.length);

    for (const trigger of sorted) {
      if (normalizedTranscript.includes(trigger.toLowerCase())) {
        return { detected: true, matchedTrigger: trigger };
      }
    }

    return { detected: false, matchedTrigger: null };
  }

  /**
   * 冻结触发词列表（运行时替换需要重新初始化）
   */
  setTriggers(triggers: string[]): void {
    if (triggers.length > 0) {
      this.triggers = [...triggers];
      logger.info('唤醒引擎 · 触发词已更新', { triggers: this.triggers });
    }
  }

  /**
   * 销毁引擎，释放资源
   */
  destroy(): void {
    this._status = 'destroyed';
    this.vad.reset();
    this.speechBuffer = new Float64Array(0);
    this.speechStartMs = 0;
    this.onWake = null;
    logger.info('唤醒引擎已销毁');
  }

  // ========== 工具方法 ==========

  private concatFloat64(a: Float64Array, b: Float64Array): Float64Array {
    const result = new Float64Array(a.length + b.length);
    result.set(a);
    result.set(b);
    return result;
  }

  private float64ToBuffer(data: Float64Array): Buffer {
    // 将 Float64Array（归一化 [-1,1]）转换为 16-bit PCM Buffer
    const int16 = new Int16Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const s = Math.max(-1, Math.min(1, data[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return Buffer.from(int16.buffer);
  }
}
