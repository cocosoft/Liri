/**
 * ImageService
 * 图像工具 API 封装层（类型转换 + 统一入口）
 *
 * 内部调用 toolService.execute() 并将原始 JSON 转为前端类型安全的接口。
 * 职责：类型转换，非编排。
 */

import { toolService } from "./toolService";
import { httpLegacy as http } from "./httpClient";

// ============================================================
// 类型定义
// ============================================================

export interface GeneratedImage {
  url: string;
  alt: string;
  size: string;
  format: string;
  provider: string;
}

export interface GenerateResult {
  images: GeneratedImage[];
  model: string;
  durationMs: number;
  usedProvider: string;
  costBreakdown: Array<{ provider: string; status: string; estimatedCostUsd: number }>;
  totalCostUsd: number;
}

export interface ImageMetadata {
  filePath: string;
  fileSize: number;
  format: string;
  width?: number;
  height?: number;
  aspectRatio?: number;
}

export interface DominantColor {
  hex: string;
  rgb: [number, number, number];
  percentage: number;
}

export interface ColorAnalysis {
  dominantColors: DominantColor[];
  palette: string;
  brightness: number;
  colorfulness: number;
}

export interface ContentAnalysis {
  sizeCategory: string;
  isSquare: boolean;
  isLandscape: boolean;
  isPortrait: boolean;
  contentDensity: string;
  sharpness: number;
}

export interface OcrResult {
  text: string;
  confidence: number;
  blocks: Array<{ text: string; confidence: number; bbox: number[][] }>;
  language: string;
}

export interface DetectedObject {
  label: string;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
}

export interface ObjectDetectionResult {
  objects: DetectedObject[];
  count: number;
  model: string;
}

export interface SimilarityResult {
  similarity: number;
  label?: string;
  mode: string;
  allScores?: Record<string, number>;
}

export interface AnalysisResult {
  action: string;
  metadata?: ImageMetadata;
  colors?: ColorAnalysis;
  content?: ContentAnalysis;
  description?: string;
  // L2 results
  text?: string;
  confidence?: number;
  blocks?: Array<{ text: string; confidence: number; bbox: number[][] }>;
  objects?: DetectedObject[];
  count?: number;
  similarity?: number;
  label?: string;
  mode?: string;
  allScores?: Record<string, number>;
}

export interface CanvasResult {
  canvasId: string;
  width: number;
  height: number;
  elementCount: number;
  outputPath?: string;
  format: string;
}

export interface EditResult {
  action: string;
  inputPath: string;
  outputPath?: string;
  originalSize?: number;
  processedSize?: number;
  width?: number;
  height?: number;
  aspectRatio?: number;
  format?: string;
  batchResults?: EditResult[];
}

// ============================================================
// ImageService
// ============================================================

export const imageService = {
  /**
   * 图片生成
   */
  async generate(
    prompt: string,
    options?: {
      size?: string;
      quality?: string;
      style?: string;
      n?: number;
      format?: string;
    }
  ): Promise<GenerateResult> {
    const raw = await toolService.execute("image_generate", {
      prompt,
      ...options,
    }) as { success: boolean; data: GenerateResult; error?: string };

    if (!raw?.success || !raw.data) {
      throw new Error(raw?.error || "Image generation failed");
    }
    return raw.data;
  },

  /**
   * 图片分析
   */
  async analyze(
    imagePath: string,
    action: string,
    options?: Record<string, unknown>
  ): Promise<AnalysisResult> {
    const raw = await toolService.execute("image_analysis", {
      action,
      inputPath: imagePath,
      ...options,
    }) as { success: boolean; data: AnalysisResult; error?: string };

    if (!raw?.success || !raw.data) {
      throw new Error(raw?.error || "Image analysis failed");
    }
    return raw.data;
  },

  /**
   * 图片编辑
   */
  async edit(
    inputPath: string,
    action: string,
    options?: Record<string, unknown>
  ): Promise<EditResult> {
    const raw = await toolService.execute("image", {
      action,
      inputPath,
      ...options,
    }) as { success: boolean; data: EditResult; error?: string };

    if (!raw?.success || !raw.data) {
      throw new Error(raw?.error || "Image edit failed");
    }
    return raw.data;
  },

  /**
   * 将本地文件路径转为可访问的 HTTP URL
   * 路径如 ~/.pyapp/output/images/2026-06-27/img_xxx.png
   * 转为 /v1/images/static/2026-06-27/img_xxx.png
   */
  getImageUrl(filePath: string): string {
    // 提取 output/images/ 之后的部分
    const match = filePath.match(/output[/\\]images[/\\](.+)$/i);
    if (match) {
      return `/v1/images/static/${match[1].replace(/\\/g, "/")}`;
    }
    // 如果不匹配，尝试直接作为 images/ 子路径
    return `/v1/images/static/${filePath.replace(/\\/g, "/")}`;
  },

  /**
   * 获取图片列表
   */
  async listImages(): Promise<Array<{ path: string; url: string }>> {
    const raw = await http.get<{ images: Array<{ path: string; url: string }> }>(
      "/v1/images/list"
    );
    return raw?.images || [];
  },
};
