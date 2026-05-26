/**
 * 环境检测器
 *
 * 分析音频背景噪声特征，自动识别当前录音环境类型，
 * 并为 VAD 检测器提供适配参数建议。
 *
 * 环境分类：
 * - quiet: 安静环境（图书馆、办公室）
 * - indoor: 室内环境（会议室、客厅）
 * - outdoor: 户外环境（街道、公园）
 * - noisy: 嘈杂环境（咖啡厅、工厂）
 * - music: 音乐/媒体播放环境
 *
 * 算法：基于长时间噪声底噪统计 + 短时能量波动分析
 */

import type { VadOptions } from './vadDetector';

/** 环境类型 */
export type EnvironmentType =
  | 'quiet'
  | 'indoor'
  | 'outdoor'
  | 'noisy'
  | 'music';

/** 环境检测结果 */
export interface EnvironmentResult {
  /** 环境类型 */
  environment: EnvironmentType;
  /** 置信度（0-1） */
  confidence: number;
  /** 平均噪声能量 */
  avgNoiseEnergy: number;
  /** 能量标准差（波动程度） */
  energyStdDev: number;
  /** 为该环境推荐的 VAD 参数 */
  recommendedVadOptions: Partial<VadOptions>;
}

/** 环境检测配置 */
export interface EnvironmentDetectorOptions {
  /** 分析窗口大小（样本数，默认 16000 = 1s @ 16kHz） */
  windowSize?: number;
  /** 环境判定所需的分析窗口数（默认 30 = 30s 分析） */
  requiredWindows?: number;
  /** 采样率（默认 16000） */
  sampleRate?: number;
}

const DEFAULT_ENV_OPTIONS: Required<EnvironmentDetectorOptions> = {
  windowSize: 16000,
  requiredWindows: 30,
  sampleRate: 16000,
};

/** 各环境推荐的 VAD 参数 */
const ENVIRONMENT_VAD_PRESETS: Record<EnvironmentType, VadOptions> = {
  quiet: {
    thresholdMultiplier: 1.8,
    minSpeechThreshold: 0.0005,
    minSpeechDurationMs: 120,
    silenceHoldMs: 400,
  },
  indoor: {
    thresholdMultiplier: 2.0,
    minSpeechThreshold: 0.001,
    minSpeechDurationMs: 150,
    silenceHoldMs: 300,
  },
  outdoor: {
    thresholdMultiplier: 2.5,
    minSpeechThreshold: 0.003,
    minSpeechDurationMs: 180,
    silenceHoldMs: 250,
  },
  noisy: {
    thresholdMultiplier: 3.0,
    minSpeechThreshold: 0.005,
    minSpeechDurationMs: 200,
    silenceHoldMs: 200,
  },
  music: {
    thresholdMultiplier: 3.5,
    minSpeechThreshold: 0.004,
    minSpeechDurationMs: 300,
    silenceHoldMs: 500,
  },
};

/**
 * 环境检测器
 */
export class EnvironmentDetector {
  private options: Required<EnvironmentDetectorOptions>;
  private windowBuffer: number[] = [];
  private windowCount: number = 0;
  private accumulatedEnergy: number = 0;
  private accumulatedEnergySq: number = 0;
  private energyHistory: number[] = [];

  constructor(options?: EnvironmentDetectorOptions) {
    this.options = { ...DEFAULT_ENV_OPTIONS, ...options };
  }

  /**
   * 重置检测器状态
   */
  reset(): void {
    this.windowBuffer = [];
    this.windowCount = 0;
    this.accumulatedEnergy = 0;
    this.accumulatedEnergySq = 0;
    this.energyHistory = [];
  }

  /**
   * 处理音频数据并累积分析
   *
   * @param samples 归一化音频样本 [-1, 1]
   * @returns 如果累积了足够数据则返回环境结果，否则返回 null
   */
  process(samples: Float64Array): EnvironmentResult | null {
    const windowEnergy = this.calcWindowEnergy(samples);
    this.windowBuffer.push(windowEnergy);

    if (this.windowBuffer.length >= this.options.windowSize) {
      this.windowBuffer = [];

      this.windowCount++;
      this.accumulatedEnergy += windowEnergy;
      this.accumulatedEnergySq += windowEnergy * windowEnergy;
      this.energyHistory.push(windowEnergy);

      if (this.windowCount >= this.options.requiredWindows) {
        return this.classify();
      }
    }

    return null;
  }

  /**
   * 获取当前累积的窗口数
   */
  getProgress(): number {
    return this.windowCount / this.options.requiredWindows;
  }

  /**
   * 是否已完成分析
   */
  isComplete(): boolean {
    return this.windowCount >= this.options.requiredWindows;
  }

  /**
   * 计算一个窗口的平均能量
   */
  private calcWindowEnergy(samples: Float64Array): number {
    let sumSq = 0;
    for (let i = 0; i < samples.length; i++) {
      sumSq += samples[i] * samples[i];
    }
    return Math.sqrt(sumSq / samples.length);
  }

  /**
   * 分类环境类型
   */
  private classify(): EnvironmentResult {
    const n = this.energyHistory.length;
    const avgEnergy = this.accumulatedEnergy / n;
    const variance = this.accumulatedEnergySq / n - avgEnergy * avgEnergy;
    const stdDev = Math.max(0, Math.sqrt(variance));

    const environment = this.determineEnvironment(avgEnergy, stdDev);
    const confidence = this.calcConfidence(environment, avgEnergy, stdDev);

    return {
      environment,
      confidence,
      avgNoiseEnergy: avgEnergy,
      energyStdDev: stdDev,
      recommendedVadOptions: ENVIRONMENT_VAD_PRESETS[environment],
    };
  }

  /**
   * 基于能量特征判定环境
   */
  private determineEnvironment(
    avgEnergy: number,
    stdDev: number
  ): EnvironmentType {
    if (avgEnergy < 0.0008 && stdDev < 0.0003) {
      return 'quiet';
    }
    if (avgEnergy < 0.003 && stdDev < 0.001) {
      return 'indoor';
    }
    if (avgEnergy < 0.008 && stdDev < 0.003) {
      return 'outdoor';
    }
    if (avgEnergy >= 0.008) {
      const variationRatio = stdDev / Math.max(avgEnergy, 0.0001);
      if (variationRatio > 0.8) {
        return 'music';
      }
      return 'noisy';
    }
    const variationRatio = stdDev / Math.max(avgEnergy, 0.0001);
    if (variationRatio > 0.7) {
      return 'music';
    }
    return 'outdoor';
  }

  /**
   * 计算分类置信度
   */
  private calcConfidence(
    environment: EnvironmentType,
    avgEnergy: number,
    stdDev: number
  ): number {
    switch (environment) {
      case 'quiet':
        return Math.min(1, 0.7 + ((0.0008 - avgEnergy) / 0.0008) * 0.3);
      case 'indoor':
        return Math.min(1, 0.6 + ((0.003 - avgEnergy) / 0.002) * 0.3);
      case 'outdoor':
        return Math.min(1, 0.5 + (stdDev / avgEnergy) * 0.3);
      case 'noisy':
        return Math.min(1, 0.6 + ((avgEnergy - 0.008) / 0.01) * 0.3);
      case 'music':
        return Math.min(1, 0.5 + (stdDev / avgEnergy) * 0.4);
      default:
        return 0.5;
    }
  }

  /**
   * 获取指定环境的推荐 VAD 参数
   */
  static getVadPreset(environment: EnvironmentType): VadOptions {
    return { ...ENVIRONMENT_VAD_PRESETS[environment] };
  }

  /**
   * 获取所有环境的 VAD 预设
   */
  static getAllPresets(): Record<EnvironmentType, VadOptions> {
    return { ...ENVIRONMENT_VAD_PRESETS };
  }
}
