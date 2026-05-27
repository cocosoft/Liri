/**
 * VAD（语音活动检测）检测器
 *
 * 基于能量分析（RMS）和零交叉率（ZCR）的纯 TypeScript 实现。
 * 无第三方依赖，适用于实时音频流处理。
 *
 * 算法：
 * 1. 将音频流拆分为 30ms 帧
 * 2. 计算每帧的 RMS 能量
 * 3. 基于自适应噪声底噪判断语音/静音
 * 4. ZCR 辅助判断（浊音段 ZCR 低，清音段 ZCR 高）
 */

/** VAD 检测结果 */
export interface VadResult {
  /** 是否为语音 */
  isSpeech: boolean;
  /** 语音概率（0-1） */
  speechProbability: number;
  /** 当前帧 RMS 能量 */
  energy: number;
  /** 当前帧信噪比（dB） */
  snr: number;
  /** 当前帧零交叉率 */
  zeroCrossRate: number;
}

/** VAD 配置选项 */
export interface VadOptions {
  /** 帧大小（样本数，默认 480 = 30ms @ 16kHz） */
  frameSize?: number;
  /** 语音阈值乘数（相对于噪声底噪，默认 2.0） */
  thresholdMultiplier?: number;
  /** 语音最低阈值（防止低信噪比误判，默认 0.001） */
  minSpeechThreshold?: number;
  /** 噪声底噪更新速率（0-1，越大更新越快，默认 0.02） */
  noiseUpdateRate?: number;
  /** 语音帧最小持续时间（毫秒，默认 150） */
  minSpeechDurationMs?: number;
  /** 静音帧保持时间（毫秒，默认 300） */
  silenceHoldMs?: number;
}

const DEFAULT_VAD_OPTIONS: Required<VadOptions> = {
  frameSize: 480, // 30ms @ 16kHz
  thresholdMultiplier: 2.0,
  minSpeechThreshold: 0.001,
  noiseUpdateRate: 0.02,
  minSpeechDurationMs: 150,
  silenceHoldMs: 300,
};

/**
 * VAD 语音活动检测器
 */
export class VadDetector {
  private options: Required<VadOptions>;
  private noiseFloor: number = 0;
  private noiseFloorInitialized: boolean = false;
  private speechFrames: number = 0;
  private silenceFrames: number = 0;
  private isSpeaking: boolean = false;
  private frameBuffer: Float64Array = new Float64Array(0);
  private sampleRate: number;

  constructor(sampleRate: number = 16000, options?: VadOptions) {
    this.sampleRate = sampleRate;
    this.options = { ...DEFAULT_VAD_OPTIONS, ...options };
  }

  /**
   * 重置检测器状态
   */
  reset(): void {
    this.noiseFloor = 0;
    this.noiseFloorInitialized = false;
    this.speechFrames = 0;
    this.silenceFrames = 0;
    this.isSpeaking = false;
    this.frameBuffer = new Float64Array(0);
  }

  /**
   * 更新配置
   */
  configure(options: Partial<VadOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * 处理音频数据并返回 VAD 结果
   *
   * @param samples 归一化的音频样本数据（范围 [-1, 1]）
   * @returns VAD 检测结果
   */
  process(samples: Float64Array): VadResult {
    const frameSize = this.options.frameSize;
    this.frameBuffer = this.concatBuffer(samples);

    let result: VadResult = {
      isSpeech: false,
      speechProbability: 0,
      energy: 0,
      snr: 0,
      zeroCrossRate: 0,
    };

    while (this.frameBuffer.length >= frameSize) {
      const frame = this.frameBuffer.slice(0, frameSize);
      this.frameBuffer = this.frameBuffer.slice(frameSize);

      result = this.processFrame(frame);
    }

    return result;
  }

  /**
   * 获取当前语音状态
   */
  isActive(): boolean {
    return this.isSpeaking;
  }

  /**
   * 处理单帧音频
   */
  private processFrame(frame: Float64Array): VadResult {
    const energy = this.calcRms(frame);
    const zcr = this.calcZeroCrossRate(frame);

    if (!this.noiseFloorInitialized) {
      this.noiseFloor = energy;
      this.noiseFloorInitialized = true;
    }

    const threshold = Math.max(
      this.noiseFloor * this.options.thresholdMultiplier,
      this.options.minSpeechThreshold
    );

    const isSpeech = energy > threshold;
    const snr =
      this.noiseFloor > 0 ? 20 * Math.log10(energy / this.noiseFloor) : 0;

    const speechProbability = this.estimateProbability(energy, threshold);

    if (isSpeech) {
      this.speechFrames++;
      this.silenceFrames = 0;
    } else {
      this.silenceFrames++;
      this.noiseFloor +=
        this.options.noiseUpdateRate * (energy - this.noiseFloor);
    }

    const minSpeechFrames = Math.max(
      1,
      Math.round(
        this.options.minSpeechDurationMs /
          ((this.options.frameSize / this.sampleRate) * 1000)
      )
    );

    const holdFrames = Math.round(
      this.options.silenceHoldMs /
        ((this.options.frameSize / this.sampleRate) * 1000)
    );

    if (isSpeech && this.speechFrames >= minSpeechFrames) {
      this.isSpeaking = true;
    } else if (!isSpeech && this.silenceFrames >= holdFrames) {
      this.isSpeaking = false;
      this.speechFrames = 0;
    }

    return {
      isSpeech: this.isSpeaking,
      speechProbability,
      energy,
      snr,
      zeroCrossRate: zcr,
    };
  }

  /**
   * 计算 RMS 能量
   */
  private calcRms(samples: Float64Array): number {
    let sumSq = 0;
    for (let i = 0; i < samples.length; i++) {
      sumSq += samples[i] * samples[i];
    }
    return Math.sqrt(sumSq / samples.length);
  }

  /**
   * 计算零交叉率
   */
  private calcZeroCrossRate(samples: Float64Array): number {
    let crossings = 0;
    for (let i = 1; i < samples.length; i++) {
      if (
        (samples[i] >= 0 && samples[i - 1] < 0) ||
        (samples[i] < 0 && samples[i - 1] >= 0)
      ) {
        crossings++;
      }
    }
    return crossings / samples.length;
  }

  /**
   * 基于能量和阈值估计语音概率
   */
  private estimateProbability(energy: number, threshold: number): number {
    if (energy <= threshold) {
      const ratio = energy / threshold;
      return Math.max(0, ratio * 0.5);
    }

    const ratio = energy / threshold;
    return Math.min(1, 0.5 + ratio * 0.1);
  }

  /**
   * 合并缓冲区
   */
  private concatBuffer(newSamples: Float64Array): Float64Array {
    if (this.frameBuffer.length === 0) return newSamples;

    const result = new Float64Array(
      this.frameBuffer.length + newSamples.length
    );
    result.set(this.frameBuffer);
    result.set(newSamples, this.frameBuffer.length);
    return result;
  }
}
