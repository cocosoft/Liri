/**
 * ImageAnalysisTool
 * 图片分析工具 — 三级分析策略
 *
 * L1 — 本地快速分析：尺寸/格式/哈希/EXIF/色彩（纯 JS，毫秒级）
 * L2 — 本地模型分析：OCR/目标检测/图片相似度（StdIO → Python，按需加载模型）
 * L3 — 云端 AI 分析：LLM Vision（Google/OpenAI Provider）
 *
 * L2 在 Python 进程不可用时自动降级到 L1+L3
 */

import { Logger, LogLevel, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error/handleError';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import { ImageProcessor } from '../../media/image/ImageProcessor';
import { providerRegistry } from '../../ai/providers/ProviderRegistry';
import {
  resolveModelRoute,
  RouteKey,
} from '../../ai/router/resolveModelRoute.js';
import { imageSanitizationPolicy } from '../../security/policy/ImageSanitizationPolicy';
import { KnowledgeBaseWriter } from '../../knowledge/KnowledgeBaseWriter';
import { WorkerGuard } from '../../ai/python/WorkerGuard';

/**
 * 分析操作类型
 */
export type AnalysisAction =
  | 'metadata'
  | 'colors'
  | 'content'
  | 'compare'
  | 'full'
  | 'vision'
  | 'ocr'
  | 'objects'
  | 'similarity'
  | 'segment'
  | 'depth'
  | 'pdf';

/**
 * 图片分析输入
 */
export interface ImageAnalysisInput {
  /** 分析操作 */
  action: AnalysisAction;
  /** 目标图片路径 */
  inputPath: string;
  /** 对比图片路径（compare / similarity 操作需要） */
  comparePath?: string;
  /** 色彩采样精度（1-10） */
  samplePrecision?: number;
  /** AI 视觉分析提示词 */
  prompt?: string;
  /** OCR 语言列表（默认 ['ch_sim', 'en']） */
  languages?: string[];
  /** 相似度匹配标签列表 */
  labels?: string[];
}

/**
 * 图片元数据
 */
export interface ImageMetadata {
  filePath: string;
  fileSize: number;
  format: string;
  width?: number;
  height?: number;
  aspectRatio?: number;
  bytesPerPixel?: number;
  mimeType?: string;
}

/**
 * 色彩分析结果
 */
export interface ColorAnalysis {
  dominantColors: Array<{
    hex: string;
    rgb: [number, number, number];
    percentage: number;
  }>;
  palette: string;
  isWarm: boolean;
  isCool: boolean;
  brightness: number;
  colorfulness: number;
}

/**
 * 内容分析结果
 */
export interface ContentAnalysis {
  sizeCategory: 'icon' | 'small' | 'medium' | 'large' | 'wallpaper';
  isSquare: boolean;
  isLandscape: boolean;
  isPortrait: boolean;
  contentDensity: 'sparse' | 'moderate' | 'dense';
  sharpness: number;
}

/**
 * 对比分析结果
 */
export interface CompareAnalysis {
  sameDimensions: boolean;
  dimensionDiff: string;
  sizeRatio: number;
  aspectRatioDiff: number;
  sameFormat: boolean;
}

/**
 * 完整分析结果
 */
export interface FullAnalysis {
  metadata: ImageMetadata;
  colors: ColorAnalysis;
  content: ContentAnalysis;
}

/**
 * OCR 结果
 */
export interface OcrResult {
  text: string;
  confidence: number;
  blocks: Array<{
    text: string;
    confidence: number;
    bbox: number[][];
  }>;
  language: string;
}

/**
 * 目标检测结果
 */
export interface ObjectDetectionResult {
  objects: Array<{
    label: string;
    confidence: number;
    bbox: { x: number; y: number; width: number; height: number };
  }>;
  count: number;
  model: string;
}

/**
 * 相似度分析结果
 */
export interface SimilarityResult {
  similarity: number;
  label?: string;
  text?: string;
  mode: 'image_vs_text' | 'image_vs_image';
  allScores?: Record<string, number>;
}

const processor = new ImageProcessor();
const logger = new Logger({
  level: LogLevel.INFO,
  module: 'tools:imageAnalysis',
});

/** L2 分析 WorkerGuard（懒加载单例） */
let l2WorkerGuard: WorkerGuard | null = null;

/**
 * 获取 L2 分析的 WorkerGuard 实例
 * Python 进程不可用时返回 null，调用方应降级到 L3
 */
function getL2WorkerGuard(): WorkerGuard | null {
  if (l2WorkerGuard && !l2WorkerGuard.isReady()) {
    return null;
  }
  if (!l2WorkerGuard) {
    l2WorkerGuard = new WorkerGuard({
      maxRestarts: 5,
      restartDelayBaseMs: 1000,
      circuitBreaker: true,
      healthCheckIntervalMs: 30000,
    });
  }
  return l2WorkerGuard;
}

export class ImageAnalysisTool extends BaseTool {
  name = 'image_analysis';

  description =
    'Analyze image content including metadata, colors, OCR text recognition, ' +
    'object detection, visual description (vision), and image similarity. ' +
    'Use when the user asks what is in an image, requests analysis, or needs ' +
    'to compare images. inputPath can be obtained from attachedImages or previous tool results.';

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      enum: [
        'metadata',
        'colors',
        'content',
        'compare',
        'full',
        'vision',
        'ocr',
        'objects',
        'similarity',
      ],
      description: 'Analysis action to perform',
      required: true,
    },
    {
      name: 'inputPath',
      type: 'string',
      description: 'Path to the input image file',
      required: true,
    },
    {
      name: 'comparePath',
      type: 'string',
      description: 'Path to the second image for comparison',
      required: false,
    },
    {
      name: 'samplePrecision',
      type: 'number',
      description:
        'Color sampling precision (1-10, higher is more accurate but slower, default 3)',
      required: false,
      default: 3,
    },
    {
      name: 'prompt',
      type: 'string',
      description: 'AI vision analysis prompt (used for vision / full action)',
      required: false,
    },
    {
      name: 'languages',
      type: 'array',
      description: 'OCR languages (default [ch_sim, en])',
      required: false,
    },
    {
      name: 'labels',
      type: 'array',
      description:
        'Labels for similarity matching (e.g. ["cat", "dog", "car"])',
      required: false,
    },
  ];

  async execute(input: unknown, _context: ToolUseContext): Promise<ToolResult> {
    try {
      const params = input as ImageAnalysisInput;

      if (!params.inputPath) {
        logger.warn('ImageAnalysisTool · 缺少 inputPath');
        return { success: false, error: 'inputPath is required' };
      }

      if (!fs.existsSync(params.inputPath)) {
        logger.warn('ImageAnalysisTool · 输入文件不存在', {
          inputPath: params.inputPath,
        });
        return {
          success: false,
          error: `Input file not found: ${params.inputPath}`,
        };
      }

      const stat = fs.statSync(params.inputPath);
      if (!stat.isFile()) {
        logger.warn('ImageAnalysisTool · 输入不是文件', {
          inputPath: params.inputPath,
        });
        return { success: false, error: `Not a file: ${params.inputPath}` };
      }

      // 安全检查
      const checkBuffer = fs.readFileSync(params.inputPath);
      const ext = path.extname(params.inputPath).slice(1).toLowerCase();
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        gif: 'image/gif',
        bmp: 'image/bmp',
      };
      const checkMime = mimeMap[ext] || `image/${ext}`;
      const sanitizeResult = imageSanitizationPolicy.sanitize(
        checkBuffer,
        checkMime
      );

      if (!sanitizeResult.sanitized) {
        logger.warn('ImageAnalysisTool · 安全检查未通过', {
          inputPath: params.inputPath,
          warnings: sanitizeResult.warnings,
        });
        return {
          success: false,
          error: `Image failed security check: ${sanitizeResult.warnings.join(', ')}`,
        };
      }

      if (sanitizeResult.warnings.length > 0) {
        logger.warn('ImageAnalysisTool · 安全检查告警', {
          warnings: sanitizeResult.warnings,
        });
      }

      logger.info('ImageAnalysisTool · 执行', {
        action: params.action,
        inputPath: params.inputPath,
      });

      // OTel 追踪
      const otel = getOTelTracing();
      const span = otel.startSpan('image.analyze', {
        'analysis.action': params.action,
        'analysis.file_size': stat.size,
      });

      let result: ToolResult;
      try {
        switch (params.action) {
          case 'metadata':
            result = this.handleMetadata(params);
            break;
          case 'colors':
            result = this.handleColors(params);
            break;
          case 'content':
            result = this.handleContent(params);
            break;
          case 'compare':
            result = this.handleCompare(params);
            break;
          case 'full':
            result = await this.handleFull(params);
            break;
          case 'vision':
            result = await this.handleVision(params);
            break;
          case 'ocr':
            result = await this.handleOcr(params);
            break;
          case 'objects':
            result = await this.handleObjectDetection(params);
            break;
          case 'similarity':
            result = await this.handleSimilarity(params);
            break;
          case 'segment':
            result = await this.handleSegment(params);
            break;
          case 'depth':
            result = await this.handleDepth(params);
            break;
          case 'pdf':
            result = await this.handlePdfInput(params);
            break;
          default:
            logger.warn('ImageAnalysisTool · 未知操作', {
              action: params.action,
            });
            result = {
              success: false,
              error: `Unknown action: ${params.action}`,
            };
        }

        otel.endSpan(
          span,
          result.success ? SpanStatusCode.OK : SpanStatusCode.ERROR
        );

        // 分析成功后将结果写入知识库
        if (result.success) {
          this.recordAnalysisToKnowledgeBase(params, result).catch(
            (err: unknown) => {
              logger.warn('ImageAnalysisTool · 知识库写入失败', {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          );
        }

        return result;
      } catch (spanError) {
        otel.endSpan(span, SpanStatusCode.ERROR, String(spanError));
        throw spanError;
      }
    } catch (error) {
      await handleError(error, {
        module: 'tools:imageAnalysis',
        action: (input as ImageAnalysisInput)?.action ?? 'unknown',
      });
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Image analysis failed: ${errorMsg}` };
    }
  }

  // ---- L2 本地模型分析 ----

  /**
   * OCR 文字识别（L2 → Python EasyOCR）
   * 降级：Python 不可用时返回错误提示
   */
  private async handleOcr(params: ImageAnalysisInput): Promise<ToolResult> {
    const guard = getL2WorkerGuard();

    if (!guard) {
      return {
        success: false,
        error:
          'L2 OCR is unavailable. Python worker circuit is open. Try L3 vision analysis instead.',
        data: { l2Unavailable: true },
      };
    }

    try {
      const response = await guard.request<OcrResult>('ocr', {
        image_path: params.inputPath,
        languages: params.languages ?? ['ch_sim', 'en'],
      });

      logger.info('ImageAnalysisTool · OCR 完成', {
        textLength: response.text.length,
        blocks: response.blocks.length,
      });

      return {
        success: true,
        data: response,
        output: response.text,
      };
    } catch (error) {
      await handleError(error, {
        module: 'tools:imageAnalysis',
        action: 'analyze.l2.ocr',
      });

      // 降级到 L3 云端分析
      logger.warn('ImageAnalysisTool · L2 OCR 失败，降级到 L3');
      return this.handleVision({
        ...params,
        prompt: '请识别并提取这张图片中的所有文字。',
      });
    }
  }

  /**
   * 目标检测（L2 → Python YOLOv8n）
   * 降级：Python 不可用时返回错误提示
   */
  private async handleObjectDetection(
    params: ImageAnalysisInput
  ): Promise<ToolResult> {
    const guard = getL2WorkerGuard();

    if (!guard) {
      return {
        success: false,
        error:
          'L2 object detection is unavailable. Python worker circuit is open.',
        data: { l2Unavailable: true },
      };
    }

    try {
      const response = await guard.request<ObjectDetectionResult>(
        'object_detection',
        {
          image_path: params.inputPath,
          model: 'yolov8n',
        }
      );

      const lines = [
        `Object Detection Results (${response.count} objects):`,
        ...response.objects.map(
          (o) =>
            `  ${o.label}: ${(o.confidence * 100).toFixed(1)}% at (${o.bbox.x}, ${o.bbox.y}, ${o.bbox.width}x${o.bbox.height})`
        ),
      ];

      return {
        success: true,
        data: response,
        output: lines.join('\n'),
      };
    } catch (error) {
      await handleError(error, {
        module: 'tools:imageAnalysis',
        action: 'analyze.l2.yolo',
      });

      logger.warn('ImageAnalysisTool · L2 目标检测失败，降级到 L3');
      return this.handleVision({
        ...params,
        prompt: '请列出这张图片中包含的所有物体。',
      });
    }
  }

  /**
   * 图片相似度分析（L2 → Python CLIP）
   * 降级：Python 不可用时返回错误提示
   */
  private async handleSimilarity(
    params: ImageAnalysisInput
  ): Promise<ToolResult> {
    const guard = getL2WorkerGuard();

    if (!guard) {
      return {
        success: false,
        error:
          'L2 similarity analysis is unavailable. Python worker circuit is open.',
        data: { l2Unavailable: true },
      };
    }

    try {
      const requestParams: Record<string, unknown> = {
        image_path: params.inputPath,
      };

      if (params.labels && params.labels.length > 0) {
        requestParams.labels = params.labels;
      } else if (params.comparePath) {
        requestParams.compare_path = params.comparePath;
      } else if (params.prompt) {
        requestParams.text = params.prompt;
      } else {
        return {
          success: false,
          error:
            'Requires labels, comparePath, or prompt for similarity analysis',
        };
      }

      const response = await guard.request<SimilarityResult>(
        'image_similarity',
        requestParams
      );

      const scoreText = `Similarity: ${(response.similarity * 100).toFixed(1)}%`;
      let output = scoreText;
      if (response.label) output += `\nBest match: ${response.label}`;
      if (response.allScores) {
        output +=
          '\n' +
          Object.entries(response.allScores)
            .map(([k, v]) => `  ${k}: ${(v * 100).toFixed(1)}%`)
            .join('\n');
      }

      return { success: true, data: response, output };
    } catch (error) {
      await handleError(error, {
        module: 'tools:imageAnalysis',
        action: 'analyze.l2.clip',
      });
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Similarity analysis failed: ${errorMsg}`,
      };
    }
  }

  // ---- 知识库记录 ----

  /**
   * 将分析结果异步写入知识库（fire-and-forget）
   */
  private async recordAnalysisToKnowledgeBase(
    params: ImageAnalysisInput,
    result: ToolResult
  ): Promise<void> {
    const writer = new KnowledgeBaseWriter();
    const output = result.output || '';
    const action = params.action;

    const title = `图片分析: ${path.basename(params.inputPath)} — ${action}`;
    const content = [
      `## 图片分析结果`,
      ``,
      `**文件**: ${params.inputPath}`,
      `**分析类型**: ${action}`,
      `**时间**: ${new Date().toISOString()}`,
      ``,
      `### 分析输出`,
      ``,
      output,
    ].join('\n');

    await writer.writeEntry({
      title,
      content,
      category: 'image-analysis',
      tags: ['image', 'analysis', action],
      source: 'ImageAnalysisTool',
    });
  }

  // ---- L1 分析 ----

  private handleMetadata(params: ImageAnalysisInput): ToolResult {
    const metadata = this.extractMetadata(params.inputPath);
    const lines = [
      `File: ${metadata.filePath}`,
      `Size: ${(metadata.fileSize / 1024).toFixed(1)} KB (${metadata.fileSize} bytes)`,
      `Format: ${metadata.format}`,
    ];
    if (metadata.width && metadata.height) {
      lines.push(`Dimensions: ${metadata.width} x ${metadata.height}`);
      lines.push(`Aspect Ratio: ${metadata.aspectRatio?.toFixed(3)}`);
    }
    if (metadata.bytesPerPixel !== undefined) {
      lines.push(`Bytes Per Pixel: ${metadata.bytesPerPixel.toFixed(2)}`);
    }
    if (metadata.mimeType) {
      lines.push(`MIME Type: ${metadata.mimeType}`);
    }
    return { success: true, data: { metadata }, output: lines.join('\n') };
  }

  private handleColors(params: ImageAnalysisInput): ToolResult {
    const precision = Math.max(1, Math.min(10, params.samplePrecision ?? 3));
    const metadata = this.extractMetadata(params.inputPath);
    const colors = this.analyzeColors(params.inputPath, precision);
    const lines = [
      `Color Analysis for: ${params.inputPath}`,
      `Dominant Colors:`,
      ...colors.dominantColors.map(
        (c) =>
          `  ${c.hex} (${c.rgb.join(',')}) - ${(c.percentage * 100).toFixed(1)}%`
      ),
      `Palette: ${colors.palette}`,
      `Tone: ${colors.isWarm ? 'Warm' : ''}${colors.isWarm && colors.isCool ? ' / ' : ''}${colors.isCool ? 'Cool' : ''}`,
      `Brightness: ${(colors.brightness * 100).toFixed(0)}%`,
      `Colorfulness: ${(colors.colorfulness * 100).toFixed(0)}%`,
    ];
    return {
      success: true,
      data: { colors, metadata },
      output: lines.join('\n'),
    };
  }

  private handleContent(params: ImageAnalysisInput): ToolResult {
    const metadata = this.extractMetadata(params.inputPath);
    const content = this.analyzeContent(metadata);
    if (!metadata.width || !metadata.height) {
      return {
        success: false,
        error: 'Cannot analyze content: unable to determine image dimensions',
      };
    }
    const lines = [
      `Content Analysis for: ${params.inputPath}`,
      `Dimensions: ${metadata.width} x ${metadata.height}`,
      `Orientation: ${content.isSquare ? 'Square' : content.isLandscape ? 'Landscape' : 'Portrait'}`,
      `Size Category: ${content.sizeCategory}`,
      `Content Density: ${content.contentDensity}`,
      `Sharpness Estimate: ${(content.sharpness * 100).toFixed(0)}%`,
    ];
    return {
      success: true,
      data: { content, metadata },
      output: lines.join('\n'),
    };
  }

  private handleCompare(params: ImageAnalysisInput): ToolResult {
    if (!params.comparePath) {
      return {
        success: false,
        error: 'comparePath is required for compare action',
      };
    }
    if (!fs.existsSync(params.comparePath)) {
      return {
        success: false,
        error: `Compare file not found: ${params.comparePath}`,
      };
    }
    const metaA = this.extractMetadata(params.inputPath);
    const metaB = this.extractMetadata(params.comparePath);
    const comparison = this.compareImages(metaA, metaB);
    const lines = [
      'Image Comparison:',
      '',
      '--- Image A ---',
      `  ${params.inputPath}`,
      `  ${metaA.width || '?'} x ${metaA.height || '?'}, ${metaA.format}, ${(metaA.fileSize / 1024).toFixed(1)} KB`,
      '',
      '--- Image B ---',
      `  ${params.comparePath}`,
      `  ${metaB.width || '?'} x ${metaB.height || '?'}, ${metaB.format}, ${(metaB.fileSize / 1024).toFixed(1)} KB`,
      '',
      '--- Differences ---',
      comparison.sameDimensions
        ? '  Dimensions: Identical'
        : `  Dimensions: ${comparison.dimensionDiff}`,
      comparison.sameFormat
        ? '  Format: Identical'
        : `  Format: ${metaA.format} vs ${metaB.format}`,
      `  Size Ratio: ${comparison.sizeRatio.toFixed(2)}x`,
      metaA.aspectRatio && metaB.aspectRatio
        ? `  Aspect Ratio Diff: ${(comparison.aspectRatioDiff * 100).toFixed(2)}%`
        : '',
    ].filter(Boolean);
    return {
      success: true,
      data: { imageA: metaA, imageB: metaB, comparison },
      output: lines.join('\n'),
    };
  }

  // ---- L3 云端分析 ----

  private async handleFull(params: ImageAnalysisInput): Promise<ToolResult> {
    const precision = Math.max(1, Math.min(10, params.samplePrecision ?? 3));
    const metadata = this.extractMetadata(params.inputPath);
    const colors = this.analyzeColors(params.inputPath, precision);
    const content = this.analyzeContent(metadata);
    const lines = [
      '=== Full Image Analysis ===',
      '',
      '--- Metadata ---',
      `File: ${metadata.filePath}`,
      `Size: ${(metadata.fileSize / 1024).toFixed(1)} KB`,
      `Format: ${metadata.format}`,
      metadata.width
        ? `Dimensions: ${metadata.width} x ${metadata.height}`
        : '',
      metadata.aspectRatio
        ? `Aspect Ratio: ${metadata.aspectRatio?.toFixed(3)}`
        : '',
      '',
      '--- Color Analysis ---',
      ...colors.dominantColors.map(
        (c) => `  ${c.hex} - ${(c.percentage * 100).toFixed(1)}%`
      ),
      `Brightness: ${(colors.brightness * 100).toFixed(0)}%`,
      `Colorfulness: ${(colors.colorfulness * 100).toFixed(0)}%`,
      '',
      '--- Content Analysis ---',
      `Orientation: ${content.isSquare ? 'Square' : content.isLandscape ? 'Landscape' : 'Portrait'}`,
      `Size Category: ${content.sizeCategory}`,
      `Content Density: ${content.contentDensity}`,
    ].filter(Boolean);

    if (params.prompt) {
      const visionResult = await this.doVisionAnalysis(
        params.inputPath,
        params.prompt
      );
      if (visionResult.success) {
        lines.push('', '--- AI Vision Analysis ---', visionResult.description);
      }
    }
    return {
      success: true,
      data: { metadata, colors, content } satisfies FullAnalysis,
      output: lines.join('\n'),
    };
  }

  private async handleVision(params: ImageAnalysisInput): Promise<ToolResult> {
    const result = await this.doVisionAnalysis(
      params.inputPath,
      params.prompt || '请详细描述这张图片的内容。'
    );
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return {
      success: true,
      data: { description: result.description, durationMs: result.durationMs },
      output: result.description,
    };
  }

  private async doVisionAnalysis(
    filePath: string,
    prompt: string
  ): Promise<{
    success: boolean;
    description: string;
    error?: string;
    durationMs?: number;
  }> {
    // 通过统一模型路由获取视觉识别模型，优先匹配 support analyzeImage 的 Provider
    const visionModel = await resolveModelRoute(RouteKey.IMAGE_ANALYZE);
    let provider = providerRegistry.getByModel(visionModel);
    // 如果路由到的 Provider 不支持图片分析，回退到已知的视觉 Provider
    if (!provider?.analyzeImage) {
      provider = providerRegistry.get('google');
    }
    if (!provider?.analyzeImage) {
      provider = providerRegistry.get('openai');
    }
    if (!provider?.analyzeImage) {
      return {
        success: false,
        description: '',
        error:
          'No provider with vision capability available (try google or openai)',
      };
    }
    const imageBuffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
      bmp: 'image/bmp',
    };
    const mimeType = mimeMap[ext] || 'image/png';

    // P1-5: 响应式缩放（Vision API 图片过大时自动逐级缩小后重试）
    const MAX_VISION_BYTES = 20 * 1024 * 1024;
    let finalBuffer = imageBuffer;
    if (imageBuffer.length > MAX_VISION_BYTES) {
      const { ImageInputRouter } =
        await import('../ImageGenerateTool/ImageInputRouter');
      const router = new ImageInputRouter();
      const shrunk = await router.shrinkIfNeeded(imageBuffer, MAX_VISION_BYTES);
      finalBuffer = Buffer.from(shrunk.buffer);
    }

    return provider.analyzeImage({
      imageBuffer: finalBuffer,
      mimeType,
      prompt,
    });
  }

  // ---- 底层分析器 ----

  private extractMetadata(filePath: string): ImageMetadata {
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const dims = processor.getDimensions(filePath);
    const formatMap: Record<string, string> = {
      png: 'png',
      jpg: 'jpeg',
      jpeg: 'jpeg',
      webp: 'webp',
      gif: 'gif',
      bmp: 'bmp',
      svg: 'svg',
      tiff: 'tiff',
      tif: 'tiff',
      ico: 'ico',
      avif: 'avif',
    };
    const format = formatMap[ext] || ext;
    const mimeType = `image/${format === 'jpeg' ? 'jpeg' : format}`;
    const bytesPerPixel =
      dims?.width && dims?.height && dims.width > 0 && dims.height > 0
        ? stat.size / (dims.width * dims.height)
        : undefined;
    return {
      filePath,
      fileSize: stat.size,
      format,
      width: dims?.width,
      height: dims?.height,
      aspectRatio: dims?.aspectRatio,
      bytesPerPixel,
      mimeType,
    };
  }

  private analyzeColors(filePath: string, precision: number): ColorAnalysis {
    const buffer = fs.readFileSync(filePath);
    const step = Math.max(4, Math.round(12 / precision));
    const colorBuckets = new Map<string, number>();
    let totalSampled = 0,
      totalR = 0,
      totalG = 0,
      totalB = 0;

    for (let i = 0; i < buffer.length; i += step * 3) {
      if (i + 2 >= buffer.length) break;
      const r = buffer[i],
        g = buffer[i + 1],
        b = buffer[i + 2];
      totalR += r;
      totalG += g;
      totalB += b;
      totalSampled++;
      const key = `${Math.round(r / 32) * 32},${Math.round(g / 32) * 32},${Math.round(b / 32) * 32}`;
      colorBuckets.set(key, (colorBuckets.get(key) || 0) + 1);
    }

    const sorted = [...colorBuckets.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    const totalCount = sorted.reduce((sum, [, count]) => sum + count, 0);
    const dominantColors = sorted.map(([key, count]) => {
      const [r, g, b] = key.split(',').map(Number);
      return {
        hex: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase(),
        rgb: [r, g, b] as [number, number, number],
        percentage: totalCount > 0 ? count / totalCount : 0,
      };
    });

    const avgR = totalSampled > 0 ? totalR / totalSampled : 0;
    const avgG = totalSampled > 0 ? totalG / totalSampled : 0;
    const avgB = totalSampled > 0 ? totalB / totalSampled : 0;
    const isWarm = avgR > avgB,
      isCool = avgB > avgR;
    const brightness = (avgR + avgG + avgB) / (3 * 255);
    const colorfulness =
      dominantColors.length > 1
        ? Math.min(
            1,
            dominantColors.slice(0, 3).reduce((sum, c) => {
              const [r, g, b] = c.rgb;
              return (
                sum + Math.sqrt((r - g) ** 2 + ((r + g) / 2 - b) ** 2) / 255
              );
            }, 0) / 3
          )
        : 0;

    let palette = 'monochrome';
    if (dominantColors.length >= 3 && colorfulness > 0.3) palette = 'colorful';
    else if (isWarm && colorfulness > 0.15) palette = 'warm tones';
    else if (isCool && colorfulness > 0.15) palette = 'cool tones';
    else if (brightness > 0.7) palette = 'bright';
    else if (brightness < 0.3) palette = 'dark';

    return {
      dominantColors,
      palette,
      isWarm,
      isCool,
      brightness: Math.round(brightness * 100) / 100,
      colorfulness: Math.round(colorfulness * 100) / 100,
    };
  }

  private analyzeContent(metadata: ImageMetadata): ContentAnalysis {
    const { width, height, fileSize } = metadata;
    const w = width || 0,
      h = height || 0;
    const isSquare = w > 0 && h > 0 && Math.abs(w - h) / Math.max(w, h) < 0.05;
    const isLandscape = w > h,
      isPortrait = h > w;
    let sizeCategory: ContentAnalysis['sizeCategory'] = 'medium';
    const maxDim = Math.max(w, h);
    if (maxDim > 0 && maxDim <= 64) sizeCategory = 'icon';
    else if (maxDim <= 320) sizeCategory = 'small';
    else if (maxDim <= 1920) sizeCategory = 'medium';
    else if (maxDim <= 3840) sizeCategory = 'large';
    else sizeCategory = 'wallpaper';
    let contentDensity: ContentAnalysis['contentDensity'] = 'moderate';
    if (w > 0 && h > 0) {
      const bytesPerArea = fileSize / (w * h);
      if (bytesPerArea < 0.5) contentDensity = 'sparse';
      else if (bytesPerArea > 3) contentDensity = 'dense';
    }
    const sharpness =
      w > 0 && h > 0 && fileSize > 0
        ? Math.min(1, Math.log2(fileSize / (w * h) + 1) / 5)
        : 0.5;
    return {
      sizeCategory,
      isSquare,
      isLandscape,
      isPortrait,
      contentDensity,
      sharpness: Math.round(sharpness * 100) / 100,
    };
  }

  private compareImages(
    metaA: ImageMetadata,
    metaB: ImageMetadata
  ): CompareAnalysis {
    const sameDimensions =
      metaA.width === metaB.width && metaA.height === metaB.height;
    const sameFormat = metaA.format === metaB.format;
    const sizeRatio = metaB.fileSize > 0 ? metaA.fileSize / metaB.fileSize : 0;
    let dimensionDiff = '';
    if (metaA.width && metaB.width && metaA.height && metaB.height) {
      if (!sameDimensions) {
        dimensionDiff = `${metaA.width}x${metaA.height} (${metaA.width * metaA.height} px) vs ${metaB.width}x${metaB.height} (${metaB.width * metaB.height} px)`;
      }
    } else {
      dimensionDiff = 'Dimensions unknown for one or both images';
    }
    const aspectRatioDiff =
      metaA.aspectRatio && metaB.aspectRatio
        ? Math.abs(metaA.aspectRatio - metaB.aspectRatio) /
          Math.max(metaA.aspectRatio, metaB.aspectRatio)
        : 0;
    return {
      sameDimensions,
      dimensionDiff,
      sizeRatio: Math.round(sizeRatio * 100) / 100,
      aspectRatioDiff: Math.round(aspectRatioDiff * 100) / 100,
      sameFormat,
    };
  }

  // ---- P1+新操作: SAM 分割 / Depth 估计 / PDF 输入 / L3 缩放 ----

  /**
   * SAM 图像分割（P1-7）
   * 委托 Python vision_worker.py 执行 sam_segment 命令
   */
  private async handleSegment(params: ImageAnalysisInput): Promise<ToolResult> {
    try {
      const worker = this.getVisionWorker();
      const response = await worker.send('sam_segment', {
        image_path: params.inputPath,
      });

      if (!response.success) {
        return {
          success: false,
          error: response.error || 'SAM segmentation failed',
        };
      }

      const result = response.result as { masks?: string[]; scores?: number[] };
      const maskCount = result.masks?.length || 0;
      return {
        success: true,
        data: response.result,
        output: `SAM 分割完成，生成 ${maskCount} 个 mask`,
      };
    } catch (error) {
      return {
        success: false,
        error: `SAM segmentation failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * MiDaS 深度估计（P1-7）
   * 委托 Python vision_worker.py 执行 depth_estimate 命令
   */
  private async handleDepth(params: ImageAnalysisInput): Promise<ToolResult> {
    try {
      const worker = this.getVisionWorker();
      const response = await worker.send('depth_estimate', {
        image_path: params.inputPath,
      });

      if (!response.success) {
        return {
          success: false,
          error: response.error || 'Depth estimation failed',
        };
      }

      const result = response.result as {
        depth_image?: string;
        min_depth?: number;
        max_depth?: number;
      };
      return {
        success: true,
        data: response.result,
        output: `深度估计完成: 范围 ${result.min_depth?.toFixed(2) || '?'} ~ ${result.max_depth?.toFixed(2) || '?'}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Depth estimation failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * PDF 输入处理（P1-2）
   * 提取 PDF 页面为图片后，对首页执行默认分析
   */
  private async handlePdfInput(
    params: ImageAnalysisInput
  ): Promise<ToolResult> {
    try {
      const { extractPdfPages } =
        await import('../../media/pdf/PdfPageExtractor');
      const pages = await extractPdfPages(params.inputPath, {
        startPage: 1,
        endPage: 1,
      });

      if (pages.length === 0) {
        return { success: false, error: '无法从 PDF 提取页面' };
      }

      // 对首页执行分析
      const pdfParams: ImageAnalysisInput = {
        ...params,
        action: 'full',
        inputPath: pages[0].imagePath,
      };

      return this.handleFull(pdfParams);
    } catch (error) {
      return {
        success: false,
        error: `PDF input processing failed: ${(error as Error).message}`,
      };
    }
  }

  /** 获取 Python Vision Worker 实例 */
  private getVisionWorker(): {
    send: (
      method: string,
      params: Record<string, unknown>
    ) => Promise<{ success: boolean; result?: unknown; error?: string }>;
  } {
    const guard = getL2WorkerGuard();
    if (!guard) {
      throw new Error('Vision Worker not available');
    }
    return {
      send: async (method: string, params: Record<string, unknown>) => {
        try {
          const result = await guard.request(method, params);
          return { success: true, result };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
    };
  }
}

export function createImageAnalysisTool(): ImageAnalysisTool {
  return new ImageAnalysisTool();
}
