/**
 * AudioLevelMeter
 * 音频电平表
 *
 * 实时计算 PCM 音频数据的 RMS 电平和峰值电平，
 * 提供电平状态回调用于 UI 展示（如语音电平可视化）。
 *
 * 支持两种输入格式：
 *   - Float64Array：归一化样本（范围 [-1, 1]）
 *   - Int16Array：PCM16 原始样本
 */

/**
 * 电平等级
 */
export type LevelCategory =
  | 'silent'
  | 'quiet'
  | 'moderate'
  | 'loud'
  | 'clipping';

/**
 * 电平测量结果
 */
export interface LevelResult {
  /** 当前 RMS 电平（dB，范围 -90 ~ 0） */
  rms: number;
  /** 当前峰值电平（dB，范围 -90 ~ 0） */
  peak: number;
  /** 电平等级分类 */
  category: LevelCategory;
  /** RMS 电平归一化值（0-1） */
  normalized: number;
}

/**
 * 电平变化回调
 */
export type LevelCallback = (level: LevelResult) => void;

/**
 * 电平计量配置
 */
export interface LevelMeterOptions {
  /** 窗口大小（样本数），默认 1024 */
  windowSize?: number;
  /** 回调触发间隔（毫秒），默认 100 */
  intervalMs?: number;
  /** 静音阈值（dB），低于此值视为静音，默认 -50 */
  silenceThreshold?: number;
  /** 最大参考值（dB FS），默认 0 */
  maxReference?: number;
}

/** 默认配置 */
const DEFAULT_OPTIONS: Required<LevelMeterOptions> = {
  windowSize: 1024,
  intervalMs: 100,
  silenceThreshold: -50,
  maxReference: 0,
};

/**
 * 音频电平表
 */
export class AudioLevelMeter {
  private options: Required<LevelMeterOptions>;
  private callback: LevelCallback | null = null;
  private lastCallbackTime: number = 0;
  private sampleBuffer: Float64Array = new Float64Array(0);
  private sampleRate: number;

  /**
   * @param sampleRate 采样率（Hz），默认 16000
   * @param options 配置选项
   */
  constructor(sampleRate: number = 16000, options?: LevelMeterOptions) {
    this.sampleRate = sampleRate;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * 更新配置
   */
  configure(options: Partial<LevelMeterOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * 设置电平变化回调
   */
  onLevel(callback: LevelCallback): void {
    this.callback = callback;
  }

  /**
   * 移除电平回调
   */
  offLevel(): void {
    this.callback = null;
  }

  /**
   * 处理 Float64Array 格式的音频样本（归一化范围 [-1, 1]）
   *
   * @param samples 归一化音频样本
   * @returns 当前窗口的电平结果（如窗口不足则返回 null）
   */
  processFloat64(samples: Float64Array): LevelResult | null {
    this.sampleBuffer = this.concatBuffer(this.sampleBuffer, samples);
    return this.processInternal();
  }

  /**
   * 处理 Int16Array 格式的 PCM16 音频样本
   *
   * @param samples PCM16 音频样本
   * @returns 当前窗口的电平结果（如窗口不足则返回 null）
   */
  processPCM16(samples: Int16Array): LevelResult | null {
    const normalized = this.normalizePCM16(samples);
    this.sampleBuffer = this.concatBuffer(this.sampleBuffer, normalized);
    return this.processInternal();
  }

  /**
   * 重置电平表状态
   */
  reset(): void {
    this.sampleBuffer = new Float64Array(0);
    this.lastCallbackTime = 0;
  }

  /**
   * 从 PCM16 Buffer 计算 RMS 电平（便捷静态方法）
   *
   * @param buffer PCM16 Buffer 对象
   * @returns 归一化电平值（0-1）
   */
  static rmsFromBuffer(buffer: Buffer): number {
    const samples = new Int16Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength / 2
    );

    let sumSq = 0;
    for (let i = 0; i < samples.length; i++) {
      const normalized = samples[i] / 32768;
      sumSq += normalized * normalized;
    }

    const rms = Math.sqrt(sumSq / samples.length);
    return rms;
  }

  /**
   * 将 RMS 值转换为 dB
   */
  static toDecibel(rms: number, maxRef: number = 0): number {
    if (rms <= 0) return -90;
    const dB = 20 * Math.log10(rms);
    return Math.max(-90, Math.min(maxRef, dB));
  }

  /**
   * 将 dB 值映射到电平分类
   */
  static categorize(dB: number): LevelCategory {
    if (dB <= -50) return 'silent';
    if (dB <= -30) return 'quiet';
    if (dB <= -15) return 'moderate';
    if (dB <= -3) return 'loud';
    return 'clipping';
  }

  /**
   * 将 dB 值归一化到 0-1 范围
   */
  static normalizeLevel(dB: number): number {
    const clamped = Math.max(-60, Math.min(0, dB));
    return (clamped + 60) / 60;
  }

  /**
   * 处理内部缓冲区
   */
  private processInternal(): LevelResult | null {
    const windowSize = this.options.windowSize;

    if (this.sampleBuffer.length < windowSize) {
      return null;
    }

    const window = this.sampleBuffer.slice(0, windowSize);
    this.sampleBuffer = this.sampleBuffer.slice(windowSize);

    const rms = this.calcRms(window);
    const peak = this.calcPeak(window);
    const rmsDb = AudioLevelMeter.toDecibel(rms, this.options.maxReference);
    const peakDb = AudioLevelMeter.toDecibel(peak, this.options.maxReference);
    const category = AudioLevelMeter.categorize(rmsDb);
    const normalized = AudioLevelMeter.normalizeLevel(rmsDb);

    const result: LevelResult = {
      rms: rmsDb,
      peak: peakDb,
      category,
      normalized,
    };

    this.triggerCallback(result);

    return result;
  }

  /**
   * 触发回调（带节流控制）
   */
  private triggerCallback(result: LevelResult): void {
    if (!this.callback) return;

    const now = Date.now();
    if (now - this.lastCallbackTime < this.options.intervalMs) return;

    this.lastCallbackTime = now;
    this.callback(result);
  }

  /**
   * 计算 RMS
   */
  private calcRms(samples: Float64Array): number {
    let sumSq = 0;
    for (let i = 0; i < samples.length; i++) {
      sumSq += samples[i] * samples[i];
    }
    return Math.sqrt(sumSq / samples.length);
  }

  /**
   * 计算峰值
   */
  private calcPeak(samples: Float64Array): number {
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const abs = Math.abs(samples[i]);
      if (abs > peak) peak = abs;
    }
    return peak;
  }

  /**
   * 将 PCM16 Int16Array 归一化为 Float64Array（范围 [-1, 1]）
   */
  private normalizePCM16(samples: Int16Array): Float64Array {
    const result = new Float64Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      result[i] = samples[i] / 32768;
    }
    return result;
  }

  /**
   * 合并缓冲区
   */
  private concatBuffer(
    existing: Float64Array,
    newData: Float64Array
  ): Float64Array {
    if (existing.length === 0) return newData;

    const result = new Float64Array(existing.length + newData.length);
    result.set(existing);
    result.set(newData, existing.length);
    return result;
  }
}
