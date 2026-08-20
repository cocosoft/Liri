/**
 * ModelRecommender — 模型智能推荐服务
 *
 * 基于硬件配置（CPU、内存、GPU）自动匹配最佳模型量化版本。
 * 设计文档：dev_docs/20260819/llama_cpp模型目录配置与迁移功能设计方案.md
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { HardwareInfo, HardwareDetector } from './HardwareDetector';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'ai:llama:recommender',
});

/** 推荐的模型条目 */
export interface ModelRecommendation {
  modelId: string;
  displayName: string;
  quantVersion: string;
  fileSizeGB: number;
  qualityScore: number;
  suitability: 'high' | 'medium' | 'low';
  estimatedRamGB: number;
  recommendedGpuLayers: number;
  recommendationReason: string;
}

/** 模型规格定义 */
interface ModelSpec {
  modelId: string;
  displayName: string;
  parameterSize: number; // B (十亿参数)
  contextWindow: number;
  quantizations: Array<{
    version: string;
    sizeFactor: number; // 相对 FP16 的压缩因子
    qualityScore: number; // 0-100
  }>;
}

/**
 * 模型推荐器
 */
export class ModelRecommender {
  /** 内置模型库（覆盖主流开源模型） */
  private readonly modelLibrary: ModelSpec[] = [
    {
      modelId: 'qwen3-8b',
      displayName: 'Qwen3 8B',
      parameterSize: 8,
      contextWindow: 32768,
      quantizations: [
        { version: 'Q4_K_M', sizeFactor: 0.27, qualityScore: 85 },
        { version: 'Q5_K_M', sizeFactor: 0.33, qualityScore: 90 },
        { version: 'Q6_K', sizeFactor: 0.4, qualityScore: 94 },
        { version: 'Q8_0', sizeFactor: 0.5, qualityScore: 98 },
      ],
    },
    {
      modelId: 'qwen3.5-14b',
      displayName: 'Qwen3.5 14B',
      parameterSize: 14,
      contextWindow: 32768,
      quantizations: [
        { version: 'Q4_K_M', sizeFactor: 0.27, qualityScore: 85 },
        { version: 'Q5_K_M', sizeFactor: 0.33, qualityScore: 90 },
        { version: 'Q6_K', sizeFactor: 0.4, qualityScore: 94 },
        { version: 'Q8_0', sizeFactor: 0.5, qualityScore: 98 },
      ],
    },
    {
      modelId: 'qwen3-27b',
      displayName: 'Qwen3 27B',
      parameterSize: 27,
      contextWindow: 32768,
      quantizations: [
        { version: 'Q4_K_M', sizeFactor: 0.27, qualityScore: 85 },
        { version: 'Q5_K_M', sizeFactor: 0.33, qualityScore: 90 },
        { version: 'Q6_K', sizeFactor: 0.4, qualityScore: 94 },
      ],
    },
    {
      modelId: 'qwen3-72b',
      displayName: 'Qwen3 72B',
      parameterSize: 72,
      contextWindow: 32768,
      quantizations: [
        { version: 'Q4_K_M', sizeFactor: 0.27, qualityScore: 85 },
        { version: 'Q5_K_M', sizeFactor: 0.33, qualityScore: 90 },
      ],
    },
    {
      modelId: 'llama3.2-1b',
      displayName: 'Llama 3.2 1B',
      parameterSize: 1,
      contextWindow: 8192,
      quantizations: [
        { version: 'Q4_K_M', sizeFactor: 0.27, qualityScore: 85 },
        { version: 'Q5_K_M', sizeFactor: 0.33, qualityScore: 90 },
        { version: 'Q8_0', sizeFactor: 0.5, qualityScore: 98 },
      ],
    },
    {
      modelId: 'llama3.2-3b',
      displayName: 'Llama 3.2 3B',
      parameterSize: 3,
      contextWindow: 8192,
      quantizations: [
        { version: 'Q4_K_M', sizeFactor: 0.27, qualityScore: 85 },
        { version: 'Q5_K_M', sizeFactor: 0.33, qualityScore: 90 },
        { version: 'Q8_0', sizeFactor: 0.5, qualityScore: 98 },
      ],
    },
    {
      modelId: 'llama3.1-8b',
      displayName: 'Llama 3.1 8B',
      parameterSize: 8,
      contextWindow: 131072,
      quantizations: [
        { version: 'Q4_K_M', sizeFactor: 0.27, qualityScore: 85 },
        { version: 'Q5_K_M', sizeFactor: 0.33, qualityScore: 90 },
        { version: 'Q6_K', sizeFactor: 0.4, qualityScore: 94 },
        { version: 'Q8_0', sizeFactor: 0.5, qualityScore: 98 },
      ],
    },
    {
      modelId: 'gemma3-12b',
      displayName: 'Gemma 3 12B',
      parameterSize: 12,
      contextWindow: 32768,
      quantizations: [
        { version: 'Q4_K_M', sizeFactor: 0.27, qualityScore: 85 },
        { version: 'Q5_K_M', sizeFactor: 0.33, qualityScore: 90 },
        { version: 'Q6_K', sizeFactor: 0.4, qualityScore: 94 },
        { version: 'Q8_0', sizeFactor: 0.5, qualityScore: 98 },
      ],
    },
    {
      modelId: 'deepseek-r1-7b',
      displayName: 'DeepSeek R1 7B',
      parameterSize: 7,
      contextWindow: 131072,
      quantizations: [
        { version: 'Q4_K_M', sizeFactor: 0.27, qualityScore: 85 },
        { version: 'Q5_K_M', sizeFactor: 0.33, qualityScore: 90 },
        { version: 'Q6_K', sizeFactor: 0.4, qualityScore: 94 },
      ],
    },
    {
      modelId: 'deepseek-r1-14b',
      displayName: 'DeepSeek R1 14B',
      parameterSize: 14,
      contextWindow: 131072,
      quantizations: [
        { version: 'Q4_K_M', sizeFactor: 0.27, qualityScore: 85 },
        { version: 'Q5_K_M', sizeFactor: 0.33, qualityScore: 90 },
        { version: 'Q6_K', sizeFactor: 0.4, qualityScore: 94 },
      ],
    },
  ];

  /**
   * 根据硬件推荐最佳模型
   */
  async recommend(
    hardware: HardwareInfo,
    _detector: HardwareDetector
  ): Promise<ModelRecommendation[]> {
    const recommendations: ModelRecommendation[] = [];

    // 计算可用内存（GB）
    const availableRamGB = this._calculateAvailableRam(hardware);
    const gpuVramGB = hardware.gpu.memoryGB || 0;

    logger.info('开始模型推荐', {
      systemMemory: hardware.systemMemoryGB,
      availableRamGB,
      gpuVramGB,
      backend: hardware.llamaCppBackend,
    });

    // 遍历模型库，计算每个模型的适配性
    for (const spec of this.modelLibrary) {
      for (const quant of spec.quantizations) {
        const fileSizeGB = this._estimateFileSize(
          spec.parameterSize,
          quant.sizeFactor
        );
        const estimatedRamGB = this._estimateRamUsage(fileSizeGB, hardware);
        const suitability = this._assessSuitability(
          estimatedRamGB,
          fileSizeGB,
          availableRamGB,
          gpuVramGB
        );

        recommendations.push({
          modelId: spec.modelId,
          displayName: spec.displayName,
          quantVersion: quant.version,
          fileSizeGB: Math.round(fileSizeGB * 10) / 10,
          qualityScore: quant.qualityScore,
          suitability,
          estimatedRamGB: Math.round(estimatedRamGB * 10) / 10,
          recommendedGpuLayers: this._calculateGpuLayers(
            fileSizeGB,
            gpuVramGB,
            hardware.llamaCppBackend
          ),
          recommendationReason: this._generateReason(
            suitability,
            estimatedRamGB,
            availableRamGB,
            gpuVramGB,
            hardware.llamaCppBackend
          ),
        });
      }
    }

    // 排序：优先 high suitability，再按质量分数
    recommendations.sort((a, b) => {
      const suitOrder = { high: 0, medium: 1, low: 2 };
      if (suitOrder[a.suitability] !== suitOrder[b.suitability]) {
        return suitOrder[a.suitability] - suitOrder[b.suitability];
      }
      return b.qualityScore - a.qualityScore;
    });

    // 只返回前 15 条（避免过多选项）
    const topRecommendations = recommendations.slice(0, 15);

    logger.info('模型推荐完成', {
      totalOptions: recommendations.length,
      returnedOptions: topRecommendations.length,
      topPick: topRecommendations[0]?.displayName,
    });

    return topRecommendations;
  }

  /**
   * 计算可用内存（考虑系统预留）
   */
  private _calculateAvailableRam(hardware: HardwareInfo): number {
    // 预留 2GB 给操作系统
    const osReserveGB = 2;
    // GPU VRAM 已独立，不计入可用 RAM
    return Math.max(1, hardware.systemMemoryGB - osReserveGB);
  }

  /**
   * 估算模型文件大小（GB）
   * FP16 约 2 字节/参数，量化版本按压缩因子
   * parameterSize 单位为 B（十亿参数）
   * 公式：parameterSize × 10^9 参数 × 2 字节 / 1024^3 字节每 GB
   */
  private _estimateFileSize(parameterSize: number, sizeFactor: number): number {
    const fp16SizeGB = (parameterSize * 1_000_000_000 * 2) / 1024 ** 3;
    return fp16SizeGB * sizeFactor;
  }

  /**
   * 估算运行时内存占用（GB）
   * 约为文件大小的 1.3 倍（KV cache 等开销）
   */
  private _estimateRamUsage(
    fileSizeGB: number,
    hardware: HardwareInfo
  ): number {
    // 如果有 GPU，部分可卸载到 GPU
    if (hardware.gpu.memoryGB > 0 && hardware.llamaCppBackend !== 'cpu') {
      // 假设 70% 模型可卸载到 GPU
      const gpuOffloadRatio = 0.7;
      const cpuSize = fileSizeGB * (1 - gpuOffloadRatio);
      return cpuSize * 1.3 + fileSizeGB * gpuOffloadRatio * 0.3;
    }
    // 纯 CPU 运行
    return fileSizeGB * 1.3;
  }

  /**
   * 评估适配度
   */
  private _assessSuitability(
    estimatedRamGB: number,
    fileSizeGB: number,
    availableRamGB: number,
    gpuVramGB: number
  ): 'high' | 'medium' | 'low' {
    // 高适配：内存占用 < 可用内存的 60%
    if (estimatedRamGB < availableRamGB * 0.6) {
      return 'high';
    }
    // 中等适配：内存占用 < 可用内存的 85%
    if (estimatedRamGB < availableRamGB * 0.85) {
      return 'medium';
    }
    // 低适配：内存占用 < 可用内存
    if (estimatedRamGB < availableRamGB) {
      return 'low';
    }
    // 超出可用内存，仍然返回 low（让用户自行判断）
    return 'low';
  }

  /**
   * 计算推荐的 GPU 层数
   */
  private _calculateGpuLayers(
    fileSizeGB: number,
    gpuVramGB: number,
    backend: string
  ): number {
    // 无 GPU 或 GPU 后端为 CPU
    if (gpuVramGB <= 0 || backend === 'cpu') {
      return 0;
    }

    // 计算可卸载的层数（按比例估算）
    const gpuRatio = Math.min(1, gpuVramGB / fileSizeGB);
    // 假设总层数约为参数规模的 24 倍（保守估计）
    const estimatedTotalLayers = Math.max(24, Math.round(fileSizeGB * 8));
    const layersToOffload = Math.round(estimatedTotalLayers * gpuRatio * 0.8);

    return Math.max(0, Math.min(estimatedTotalLayers, layersToOffload));
  }

  /**
   * 生成推荐理由
   */
  private _generateReason(
    suitability: string,
    estimatedRamGB: number,
    availableRamGB: number,
    gpuVramGB: number,
    backend: string
  ): string {
    const parts: string[] = [];

    if (suitability === 'high') {
      parts.push('内存充裕');
    } else if (suitability === 'medium') {
      parts.push('内存适中');
    } else {
      parts.push('内存紧张');
    }

    parts.push(`预计占用 ${estimatedRamGB}GB / 可用 ${availableRamGB}GB`);

    if (gpuVramGB > 0 && backend !== 'cpu') {
      parts.push(`支持 ${backend.toUpperCase()} GPU 加速`);
    } else {
      parts.push('纯 CPU 运行');
    }

    return parts.join('，');
  }
}
