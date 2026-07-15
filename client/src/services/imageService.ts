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
   * SVG 矢量图生成（通过 LLM 文本生成，非图像 API）
   */
  async svgGenerate(
    prompt: string,
    options?: Record<string, unknown>
  ): Promise<{ svg: string; model: string; size: string }> {
    const raw = await toolService.execute("image_svg_generate", {
      prompt,
      ...options,
    }) as { ok: boolean; data: { success: boolean; data: { svg: string; model: string; size: string; filePath?: string }; error?: string }; error?: { message: string } };

    if (!raw?.ok || !raw.data?.success || !raw.data?.data) {
      const detail = raw?.data?.error || raw?.error?.message || JSON.stringify(raw);
      throw new Error(`SVG generation failed: ${detail}`);
    }
    return raw.data.data;
  },
  async generate(
    prompt: string,
    options?: {
      size?: string;
      quality?: string;
      style?: string;
      n?: number;
      format?: string;
      /** 参考图本地路径，用于分辨率推断 */
      inputImage?: string;
    }
  ): Promise<GenerateResult> {
    const raw = await toolService.execute("image_generate", {
      prompt,
      ...options,
    }) as { ok: boolean; data: { success: boolean; data: GenerateResult; error?: string }; error?: { message: string } };

    if (!raw?.ok || !raw.data?.success || !raw.data?.data) {
      throw new Error(raw.data?.error || raw.error?.message || "Image generation failed");
    }
    return raw.data.data;
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
    }) as { ok: boolean; data: { success: boolean; data: AnalysisResult; error?: string }; error?: { message: string } };

    if (!raw?.ok || !raw.data?.success || !raw.data?.data) {
      throw new Error(raw.data?.error || raw.error?.message || "Image analysis failed");
    }
    return raw.data.data;
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
    }) as { ok: boolean; data: { success: boolean; data: EditResult; error?: string }; error?: { message: string } };

    if (!raw?.ok || !raw.data?.success || !raw.data?.data) {
      throw new Error(raw.data?.error || raw.error?.message || "Image edit failed");
    }
    return raw.data.data;
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
   * 获取图片列表（含 TTL 缓存 + 分页）
   */
  async listImages(params?: { page?: number; pageSize?: number; signal?: AbortSignal }): Promise<{
    images: Array<{ path: string; url: string }>;
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
  }> {
    const { page = 1, pageSize = 50 } = params || {};
    const cacheKey = `listImages-${page}-${pageSize}`;
    return withCache(cacheKey, async () => {
      const raw = await http.get<{
        images: Array<{ path: string; url: string }>;
        total: number;
        page: number;
        pageSize: number;
        hasMore: boolean;
      }>(`/v1/images/list?page=${page}&pageSize=${pageSize}`);
      return raw || { images: [], total: 0, page, pageSize, hasMore: false };
    });
  },

  /**
   * 删除图片
   * 前端 URL (/v1/images/static/media/xxx.png) → 后端路径 (media/xxx.png)
   */
  async deleteImage(imagePathOrUrl: string): Promise<{ success: boolean }> {
    // 将 web URL 转为后端可识别的相对路径格式
    let backendPath = imagePathOrUrl;
    if (imagePathOrUrl.startsWith("/v1/images/static/")) {
      backendPath = imagePathOrUrl.slice("/v1/images/static/".length);
    }
    return http.delete(`/v1/images/delete?path=${encodeURIComponent(backendPath)}`);
  },

  /**
   * 画布操作
   */
  async canvas(
    action: string,
    options?: Record<string, unknown>
  ): Promise<CanvasResult> {
    const raw = await toolService.execute("canvas", { action, ...options }) as {
      ok: boolean;
      data: { success: boolean; data: CanvasResult; error?: string };
      error?: { message: string };
    };
    if (!raw?.ok || !raw.data?.success || !raw.data?.data) {
      throw new Error(raw.data?.error || raw.error?.message || "Canvas operation failed");
    }
    return raw.data.data;
  },

  /**
   * 上传图片（XHR + 进度回调）
   */
  upload(
    file: File,
    onProgress?: (pct: number) => void
  ): Promise<{ path: string; url: string }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/v1/images/upload");

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            reject(new Error("Invalid JSON response"));
          }
        } else {
          reject(new Error(`Upload failed: ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error("Network error"));
      xhr.ontimeout = () => reject(new Error("Upload timeout"));

      const formData = new FormData();
      formData.append("file", file);
      xhr.send(formData);
    });
  },
};

// ============================================================
// P2-9: 轻量级 TTL 缓存
// ============================================================

const _cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 30_000; // 30 秒

/** 缓存包装器 */
function withCache<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return Promise.resolve(cached.data as T);
  }
  return fetcher().then((data) => {
    _cache.set(key, { data, ts: Date.now() });
    return data;
  });
}

/** 清除所有缓存（生成/编辑/上传后调用） */
export function clearImageCache(): void {
  _cache.clear();
}
