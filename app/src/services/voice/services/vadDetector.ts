/**
 * VAD（语音活动检测）检测器 — 增强版
 *
 * 基于能量分析（RMS）、零交叉率（ZCR）和频谱质心的纯 TypeScript 实现。
 * 无第三方依赖，适用于实时音频流处理。
 *
 * 算法：
 * 1. 将音频流拆分为 30ms 帧（480 样本 @ 16kHz）
 * 2. 计算每帧 RMS 能量、ZCR、频谱质心
 * 3. 自适应阈值：基于百分位噪声底噪（15th percentile of recent energy window）
 * 4. 频域辅助判断：频谱质心区分语音与窄带噪声
 * 5. 动态 Hangover：高 SNR → 短静音保持，低 SNR → 长静音保持
 *
 * @example
 *   const vad = new VadDetector(16000);
 *   const result = vad.process(samples);
 *   if (result.isSpeech) { console.log('有语音'); }
 */

// ===========================================================
// 类型定义
// ===========================================================

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
  /** 频谱质心（0-1，0=低频集中，1=高频集中） */
  spectralCentroid: number;
  /** 实时音频电平（0-1，用于前端可视化） */
  audioLevel: number;
}

/** VAD 配置选项（向后兼容，新增字段可选） */
export interface VadOptions {
  /** 帧大小（样本数，默认 480 = 30ms @ 16kHz） */
  frameSize?: number;
  /** 语音阈值乘数（相对于噪声底噪，默认 1.5） */
  thresholdMultiplier?: number;
  /** 语音最低阈值（防止低信噪比误判，默认 0.001） */
  minSpeechThreshold?: number;
  /** 噪声底噪更新速率（0-1，越大更新越快，默认 0.02） */
  noiseUpdateRate?: number;
  /** 语音帧最小持续时间（毫秒，默认 150） */
  minSpeechDurationMs?: number;
  /** 静音帧保持时间（毫秒，默认 300）—— 用作动态 hangover 的基础值 */
  silenceHoldMs?: number;
  /** 频域分析权重（0-1，0=纯能量分析，1=纯频域分析，默认 0.3） */
  spectralWeight?: number;
  /** 噪声底噪估计窗口大小（帧数，默认 100 = ~3 秒） */
  noiseFloorWindowSize?: number;
  /** 噪声底噪百分位（0-100，默认 15） */
  noiseFloorPercentile?: number;
  /** 动态 hangover 最短时间（毫秒，默认 100） */
  minHangoverMs?: number;
  /** 动态 hangover 最长时间（毫秒，默认 600） */
  maxHangoverMs?: number;
  /** 启用频谱分析（默认 true） */
  enableSpectralAnalysis?: boolean;
}

// ===========================================================
// 常量
// ===========================================================

const DEFAULT_VAD_OPTIONS: Required<VadOptions> = {
  frameSize: 480, // 30ms @ 16kHz
  thresholdMultiplier: 1.5,
  minSpeechThreshold: 0.001,
  noiseUpdateRate: 0.02,
  minSpeechDurationMs: 150,
  silenceHoldMs: 300,
  spectralWeight: 0.3,
  noiseFloorWindowSize: 100,
  noiseFloorPercentile: 15,
  minHangoverMs: 100,
  maxHangoverMs: 600,
  enableSpectralAnalysis: true,
};

/** FFT 点数（2^9 = 512） */
const FFT_SIZE = 512;

/** 预计算 FFT 蝶形因子 */
const TWIDDLE_FACTORS: Array<{ cos: number; sin: number }> = (() => {
  const factors: Array<{ cos: number; sin: number }> = [];
  for (let i = 0; i < FFT_SIZE / 2; i++) {
    const angle = (-2 * Math.PI * i) / FFT_SIZE;
    factors.push({ cos: Math.cos(angle), sin: Math.sin(angle) });
  }
  return factors;
})();

/** 预计算 FFT 位反转查找表 */
const BIT_REVERSAL: Uint8Array = (() => {
  const table = new Uint8Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    table[i] = bitReverse(i, 9); // 2^9 = 512
  }
  return table;
})();

/**
 * 计算 9 位整数的位反转
 */
function bitReverse(value: number, bits: number): number {
  let result = 0;
  for (let i = 0; i < bits; i++) {
    result = (result << 1) | (value & 1);
    value >>= 1;
  }
  return result;
}

// ===========================================================
// VAD 检测器
// ===========================================================

/**
 * VAD 语音活动检测器 — 增强版
 *
 * 新增特性：
 * - 百分位噪声底噪估计（抗突发噪声干扰）
 * - 频谱质心分析（区分语音与窄带噪声）
 * - 动态 Hangover（SNR 自适应）
 * - audioLevel 输出（前端录音可视化）
 */
export class VadDetector {
  private options: Required<VadOptions>;
  private noiseFloor: number = 0;
  private noiseFloorInitialized: boolean = false;
  private speechFrames: number = 0;
  private silenceFrames: number = 0;
  private isSpeaking: boolean = false;
  private hasSpoken: boolean = false;
  private frameBuffer: Float64Array = new Float64Array(0);
  private sampleRate: number;

  /** 历史帧能量滑动窗口（用于百分位噪声估计） */
  private energyHistory: number[] = [];
  /** 历史 SNR 平滑值（用于动态 hangover） */
  private smoothedSnr: number = 0;

  /** FFT 工作缓冲区（复用避免分配） */
  private fftRe: Float64Array = new Float64Array(FFT_SIZE);
  private fftIm: Float64Array = new Float64Array(FFT_SIZE);
  private magnitudeBuf: Float64Array = new Float64Array(FFT_SIZE / 2);

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
    this.hasSpoken = false;
    this.frameBuffer = new Float64Array(0);
    this.energyHistory = [];
    this.smoothedSnr = 0;
  }

  /**
   * 更新配置
   *
   * @param options 部分配置（未提供的字段保持原值）
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
      spectralCentroid: 0,
      audioLevel: 0,
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
   *
   * @returns true 表示当前正在说话
   */
  isActive(): boolean {
    return this.isSpeaking;
  }

  /**
   * 是否曾检测到语音
   *
   * 自上次 reset() 以来是否有过 speech 帧
   *
   * @returns true 表示曾有过语音
   */
  hasEverSpoken(): boolean {
    return this.hasSpoken;
  }

  // ===========================================================
  // 私有方法
  // ===========================================================

  /**
   * 处理单帧音频
   */
  private processFrame(frame: Float64Array): VadResult {
    const energy = this.calcRms(frame);
    const zcr = this.calcZeroCrossRate(frame);

    // 更新能量历史（滑动窗口）
    this.energyHistory.push(energy);
    if (this.energyHistory.length > this.options.noiseFloorWindowSize) {
      this.energyHistory.shift();
    }

    // 自适应噪声底噪（百分位估计）
    if (!this.noiseFloorInitialized) {
      this.noiseFloor = energy;
      this.noiseFloorInitialized = true;
    } else {
      this.updateNoiseFloor();
    }

    // 频谱分析
    let spectralCentroid = 0;
    if (
      this.options.enableSpectralAnalysis &&
      frame.length === this.options.frameSize
    ) {
      spectralCentroid = this.computeSpectralCentroid(frame);
    }

    // 综合语音概率（能量 + 频谱）
    const energyThreshold = Math.max(
      this.noiseFloor * this.options.thresholdMultiplier,
      this.options.minSpeechThreshold
    );

    const snr =
      this.noiseFloor > 0
        ? 20 * Math.log10(energy / this.noiseFloor + 1e-10)
        : 0;

    // 平滑 SNR
    this.smoothedSnr =
      this.smoothedSnr > 0 ? this.smoothedSnr * 0.8 + snr * 0.2 : snr;

    // 能量判决
    const energySpeech = energy > energyThreshold;

    // 频谱判决：语音的频谱质心通常在 0.15-0.6 之间
    // 窄带噪声（风扇、电机）质心通常 < 0.1
    const spectralWeight = this.options.spectralWeight;
    const spectralSpeech = spectralCentroid > 0.12 && spectralCentroid < 0.85;

    // 综合判决
    const combinedScore =
      (1 - spectralWeight) * (energySpeech ? 1 : 0) +
      spectralWeight * (spectralSpeech ? 1 : 0);

    const isSpeech = combinedScore > 0.5;
    const speechProbability = this.estimateProbability(
      energy,
      energyThreshold,
      spectralCentroid,
      spectralWeight
    );

    // 更新噪声底噪（仅在非语音帧）
    if (!isSpeech) {
      this.noiseFloor +=
        this.options.noiseUpdateRate * (energy - this.noiseFloor);
    }

    // 动态 Hangover
    const hangoverMs = this.calcDynamicHangover();
    const holdFrames = Math.max(
      1,
      Math.round(
        hangoverMs / ((this.options.frameSize / this.sampleRate) * 1000)
      )
    );

    const minSpeechFrames = Math.max(
      1,
      Math.round(
        this.options.minSpeechDurationMs /
          ((this.options.frameSize / this.sampleRate) * 1000)
      )
    );

    if (isSpeech) {
      this.speechFrames++;
      this.silenceFrames = 0;
      this.hasSpoken = true;
    } else {
      this.silenceFrames++;
    }

    if (isSpeech && this.speechFrames >= minSpeechFrames) {
      this.isSpeaking = true;
    } else if (!isSpeech && this.silenceFrames >= holdFrames) {
      this.isSpeaking = false;
      this.speechFrames = 0;
    }

    // audioLevel：对数映射到 0-1 范围
    const audioLevel = this.calcAudioLevel(energy);

    return {
      isSpeech: this.isSpeaking,
      speechProbability,
      energy,
      snr,
      zeroCrossRate: zcr,
      spectralCentroid,
      audioLevel,
    };
  }

  /**
   * 更新噪声底噪（百分位估计）
   *
   * 从能量历史窗口中取指定百分位的值作为噪声底噪估计值。
   * 这种方法比简单的指数平滑更能抵抗突发噪声的干扰。
   */
  private updateNoiseFloor(): void {
    if (this.energyHistory.length < 10) return;

    const sorted = [...this.energyHistory].sort((a, b) => a - b);
    const percentileIndex = Math.max(
      0,
      Math.floor((this.options.noiseFloorPercentile / 100) * sorted.length) - 1
    );
    const percentileNoise = sorted[percentileIndex];

    // 用百分位估计平滑更新噪声底噪
    this.noiseFloor +=
      this.options.noiseUpdateRate * (percentileNoise - this.noiseFloor);
  }

  /**
   * 计算频谱质心
   *
   * 频谱质心 = Σ(freq_bin * magnitude[i]) / Σ(magnitude[i])
   * 反映声音的"明亮度"：语音通常有适中的质心，纯噪声（风扇等）质心偏低。
   *
   * 实现：
   * 1. 零填充 480 → 512 样本
   * 2. 512 点 FFT
   * 3. 计算幅度谱
   * 4. 计算频谱质心并归一化到 0-1
   *
   * @param frame 时域帧数据
   * @returns 归一化频谱质心（0-1）
   */
  private computeSpectralCentroid(frame: Float64Array): number {
    // 复用工作缓冲区，避免分配
    this.fftRe.fill(0);
    this.fftIm.fill(0);
    this.fftRe.set(frame);
    // 帧小于 FFT_SIZE 的部分已经是 0（fill(0) 已完成零填充）

    // 512 点基 2 FFT
    this.fft(this.fftRe, this.fftIm);

    // 计算幅度谱（仅前半部分，奈奎斯特频率以下）
    for (let i = 0; i < FFT_SIZE / 2; i++) {
      this.magnitudeBuf[i] = Math.sqrt(
        this.fftRe[i] * this.fftRe[i] + this.fftIm[i] * this.fftIm[i]
      );
    }

    // 计算频谱质心
    let weightedSum = 0;
    let magnitudeSum = 0;
    for (let i = 0; i < FFT_SIZE / 2; i++) {
      weightedSum += i * this.magnitudeBuf[i];
      magnitudeSum += this.magnitudeBuf[i];
    }

    if (magnitudeSum < 1e-10) return 0;

    // 归一化到 0-1（最大 bin 索引为 255，归一化除以 255）
    const centroid = weightedSum / magnitudeSum;
    return Math.min(1, centroid / (FFT_SIZE / 2 - 1));
  }

  /**
   * 512 点基 2 蝶形 FFT（原地计算）
   *
   * 使用预计算位反转和蝶形因子。
   * 输入长度为 FFT_SIZE，修改 re 和 im 数组。
   *
   * @param re 实部数组（输入输出）
   * @param im 虚部数组（输入输出）
   */
  private fft(re: Float64Array, im: Float64Array): void {
    const n = FFT_SIZE;

    // 位反转重排
    for (let i = 0; i < n; i++) {
      const j = BIT_REVERSAL[i];
      if (j > i) {
        // 交换实部和虚部
        const tmpRe = re[i];
        const tmpIm = im[i];
        re[i] = re[j];
        im[i] = im[j];
        re[j] = tmpRe;
        im[j] = tmpIm;
      }
    }

    // 蝶形运算
    for (let len = 2; len <= n; len <<= 1) {
      const halfLen = len >> 1;
      const step = n / len;

      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < halfLen; j++) {
          const twiddle = TWIDDLE_FACTORS[j * step];
          const tRe =
            twiddle.cos * re[i + j + halfLen] -
            twiddle.sin * im[i + j + halfLen];
          const tIm =
            twiddle.cos * im[i + j + halfLen] +
            twiddle.sin * re[i + j + halfLen];

          re[i + j + halfLen] = re[i + j] - tRe;
          im[i + j + halfLen] = im[i + j] - tIm;
          re[i + j] += tRe;
          im[i + j] += tIm;
        }
      }
    }
  }

  /**
   * 计算动态 Hangover 时间
   *
   * 高 SNR → 短 hangover（语音干净，可以更快切换）
   * 低 SNR → 长 hangover（避免噪声误切）
   *
   * @returns hangover 时间（毫秒）
   */
  private calcDynamicHangover(): number {
    const snr = this.smoothedSnr;
    const minMs = this.options.minHangoverMs;
    const maxMs = this.options.maxHangoverMs;

    // SNR 映射：
    //   >= 25dB → minHangoverMs
    //   0dB     → maxHangoverMs
    //   线性插值
    const clampedSNR = Math.max(0, Math.min(25, snr));
    const ratio = 1 - clampedSNR / 25; // 0（高 SNR）→ 1（低 SNR）

    return Math.round(minMs + ratio * (maxMs - minMs));
  }

  /**
   * 计算实时音频电平（0-1）
   *
   * 对数映射：将 RMS 能量映射到人类听觉感知的级别。
   * - 低噪声（-60dB）→ 0
   * - 满量程（0dB）→ 1
   *
   * @param energy RMS 能量
   * @returns 0-1 的音频电平值
   */
  private calcAudioLevel(energy: number): number {
    if (energy <= 0) return 0;

    // dBFS：20 * log10(energy)，energy ∈ (0, 1]
    const dBFS = 20 * Math.log10(Math.min(1, energy));

    // 将 [-60, 0] dBFS 线性映射到 [0, 1]
    // 低于 -60dB 视为静音
    const normalized = (dBFS + 60) / 60;
    return Math.max(0, Math.min(1, normalized));
  }

  /**
   * 计算 RMS 能量
   *
   * @param samples 样本数据
   * @returns RMS 能量值
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
   *
   * @param samples 样本数据
   * @returns 零交叉率（0-1）
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
   * 综合估计语音概率
   *
   * 融合能量判决和频谱判决：
   * - 能量超过阈值越多，概率越高
   * - 频谱质心在语音范围内，概率越高
   *
   * @param energy RMS 能量
   * @param threshold 能量阈值
   * @param spectralCentroid 频谱质心
   * @param spectralWeight 频谱权重
   * @returns 语音概率（0-1）
   */
  private estimateProbability(
    energy: number,
    threshold: number,
    spectralCentroid: number,
    spectralWeight: number
  ): number {
    // 能量概率
    const energyProb =
      energy <= threshold
        ? Math.max(0, (energy / threshold) * 0.5)
        : Math.min(
            1,
            0.5 + 0.5 * Math.min(1, (energy - threshold) / threshold)
          );

    // 频谱概率：质心在 0.15-0.6 之间概率最高
    let spectralProb = 0.5;
    if (spectralCentroid > 0.12 && spectralCentroid < 0.85) {
      const peak = 0.35; // 语音典型频谱质心位置
      spectralProb = 1 - Math.abs(spectralCentroid - peak) / peak;
      spectralProb = Math.max(0.1, Math.min(1, spectralProb));
    } else {
      spectralProb = 0.1;
    }

    return (1 - spectralWeight) * energyProb + spectralWeight * spectralProb;
  }

  /**
   * 合并缓冲区
   *
   * @param newSamples 新样本数据
   * @returns 合并后的缓冲区
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
