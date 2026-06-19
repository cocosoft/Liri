/**
 * ImageAnalysisTool
 * 图片分析工具
 * 支持基础视觉分析：元数据提取、色彩分析、内容检测、图片对比、AI视觉分析
 */

import { Logger, LogLevel } from '@modules/monitoring';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import { ImageProcessor } from '../../media/image/ImageProcessor';
import { providerRegistry } from '../../ai/providers/ProviderRegistry';
import { imageSanitizationPolicy } from '../../security/policy/ImageSanitizationPolicy';
import { KnowledgeBaseWriter } from '../../knowledge/KnowledgeBaseWriter';

/**
 * 分析操作类型
 */
export type AnalysisAction =
  | 'metadata'
  | 'colors'
  | 'content'
  | 'compare'
  | 'full'
  | 'vision';

/**
 * 图片分析输入
 */
export interface ImageAnalysisInput {
  /** 分析操作 */
  action: AnalysisAction;
  /** 目标图片路径 */
  inputPath: string;
  /** 对比图片路径（仅 compare 操作需要） */
  comparePath?: string;
  /** 色彩采样精度（1-10，越高越精确但越慢，默认 3） */
  samplePrecision?: number;
  /** AI 视觉分析提示词（仅 vision / full 操作使用） */
  prompt?: string;
}

/**
 * 图片元数据
 */
export interface ImageMetadata {
  /** 文件路径 */
  filePath: string;
  /** 文件大小（字节） */
  fileSize: number;
  /** 文件格式 */
  format: string;
  /** 宽度（像素） */
  width?: number;
  /** 高度（像素） */
  height?: number;
  /** 宽高比 */
  aspectRatio?: number;
  /** 字节/像素比（粗略估计色彩深度） */
  bytesPerPixel?: number;
  /** MIME 类型 */
  mimeType?: string;
}

/**
 * 色彩分析结果
 */
export interface ColorAnalysis {
  /** 主色调列表（降序） */
  dominantColors: Array<{
    hex: string;
    rgb: [number, number, number];
    percentage: number;
  }>;
  /** 色彩分布描述 */
  palette: string;
  /** 是否偏暖色调 */
  isWarm: boolean;
  /** 是否偏冷色调 */
  isCool: boolean;
  /** 整体亮度（0-1） */
  brightness: number;
  /** 色彩丰富度（0-1） */
  colorfulness: number;
}

/**
 * 内容分析结果
 */
export interface ContentAnalysis {
  /** 图片尺寸分类 */
  sizeCategory: 'icon' | 'small' | 'medium' | 'large' | 'wallpaper';
  /** 是否方形 */
  isSquare: boolean;
  /** 是否横向 */
  isLandscape: boolean;
  /** 是否纵向 */
  isPortrait: boolean;
  /** 内容密度描述 */
  contentDensity: 'sparse' | 'moderate' | 'dense';
  /** 锐度估计（0-1） */
  sharpness: number;
}

/**
 * 对比分析结果
 */
export interface CompareAnalysis {
  /** 是否相同尺寸 */
  sameDimensions: boolean;
  /** 尺寸差异描述 */
  dimensionDiff: string;
  /** 文件大小比 */
  sizeRatio: number;
  /** 宽高比差异 */
  aspectRatioDiff: number;
  /** 格式是否相同 */
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

const processor = new ImageProcessor();

const logger = new Logger({ level: LogLevel.INFO });

export class ImageAnalysisTool extends BaseTool {
  name = 'image_analysis';

  description =
    'Analyze images to extract metadata, color information, content characteristics, and compare images. Supports local image files.';

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      enum: ['metadata', 'colors', 'content', 'compare', 'full', 'vision'],
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
      description:
        'Path to the second image for comparison (required for compare action)',
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

      let result: ToolResult;
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
        default:
          logger.warn('ImageAnalysisTool · 未知操作', {
            action: params.action,
          });
          return {
            success: false,
            error: `Unknown action: ${params.action}. Supported: metadata, colors, content, compare, full, vision`,
          };
      }

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
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('ImageAnalysisTool · 执行失败', { error: errorMsg });
      return {
        success: false,
        error: `Image analysis failed: ${errorMsg}`,
      };
    }
  }

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

  /**
   * 提取图片元数据
   */
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

    return {
      success: true,
      data: { metadata },
      output: lines.join('\n'),
    };
  }

  /**
   * 色彩分析
   */
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

  /**
   * 内容特征分析
   */
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

  /**
   * 图片对比分析
   */
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

  /**
   * 完整分析（metadata + colors + content）
   */
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
    // 如果提供了 prompt，追加 AI 视觉分析
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

  /**
   * AI 视觉分析：调用 Provider 分析图片内容
   */
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

  /**
   * 执行 AI Vision 分析
   */
  private async doVisionAnalysis(
    filePath: string,
    prompt: string
  ): Promise<{
    success: boolean;
    description: string;
    error?: string;
    durationMs?: number;
  }> {
    let provider = providerRegistry.get('google');

    if (!provider.analyzeImage) {
      provider = providerRegistry.get('openai');
    }

    if (!provider.analyzeImage) {
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

    return provider.analyzeImage({ imageBuffer, mimeType, prompt });
  }

  /**
   * 提取图片元数据
   */
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

  /**
   * 色彩分析（基于像素采样）
   */
  private analyzeColors(filePath: string, precision: number): ColorAnalysis {
    const buffer = fs.readFileSync(filePath);
    const totalPixels = buffer.length;

    const step = Math.max(4, Math.round(12 / precision));
    const colorBuckets = new Map<string, number>();
    let totalSampled = 0;
    let totalR = 0,
      totalG = 0,
      totalB = 0;

    for (let i = 0; i < buffer.length; i += step * 3) {
      if (i + 2 >= buffer.length) break;

      const r = buffer[i];
      const g = buffer[i + 1];
      const b = buffer[i + 2];

      totalR += r;
      totalG += g;
      totalB += b;
      totalSampled++;

      const quantizedR = Math.round(r / 32) * 32;
      const quantizedG = Math.round(g / 32) * 32;
      const quantizedB = Math.round(b / 32) * 32;

      const key = `${quantizedR},${quantizedG},${quantizedB}`;
      colorBuckets.set(key, (colorBuckets.get(key) || 0) + 1);
    }

    const sorted = [...colorBuckets.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    const totalCount = sorted.reduce((sum, [, count]) => sum + count, 0);

    const dominantColors = sorted.map(([key, count]) => {
      const [r, g, b] = key.split(',').map(Number);
      const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
      return {
        hex: hex.toUpperCase(),
        rgb: [r, g, b] as [number, number, number],
        percentage: totalCount > 0 ? count / totalCount : 0,
      };
    });

    const avgR = totalSampled > 0 ? totalR / totalSampled : 0;
    const avgG = totalSampled > 0 ? totalG / totalSampled : 0;
    const avgB = totalSampled > 0 ? totalB / totalSampled : 0;

    const isWarm = avgR > avgB;
    const isCool = avgB > avgR;
    const brightness = (avgR + avgG + avgB) / (3 * 255);
    const colorfulness =
      dominantColors.length > 1
        ? Math.min(
            1,
            dominantColors.slice(0, 3).reduce((sum, c) => {
              const [r, g, b] = c.rgb;
              const rg = Math.abs(r - g);
              const yb = Math.abs((r + g) / 2 - b);
              return sum + Math.sqrt(rg * rg + yb * yb) / 255;
            }, 0) / 3
          )
        : 0;

    let palette = 'monochrome';
    if (dominantColors.length >= 3 && colorfulness > 0.3) {
      palette = 'colorful';
    } else if (isWarm && colorfulness > 0.15) {
      palette = 'warm tones';
    } else if (isCool && colorfulness > 0.15) {
      palette = 'cool tones';
    } else if (brightness > 0.7) {
      palette = 'bright';
    } else if (brightness < 0.3) {
      palette = 'dark';
    }

    return {
      dominantColors,
      palette,
      isWarm,
      isCool,
      brightness: Math.round(brightness * 100) / 100,
      colorfulness: Math.round(colorfulness * 100) / 100,
    };
  }

  /**
   * 内容特征分析
   */
  private analyzeContent(metadata: ImageMetadata): ContentAnalysis {
    const { width, height, fileSize } = metadata;

    const w = width || 0;
    const h = height || 0;

    const isSquare = w > 0 && h > 0 && Math.abs(w - h) / Math.max(w, h) < 0.05;
    const isLandscape = w > h;
    const isPortrait = h > w;

    let sizeCategory: ContentAnalysis['sizeCategory'] = 'medium';
    const maxDim = Math.max(w, h);
    if (maxDim > 0 && maxDim <= 64) sizeCategory = 'icon';
    else if (maxDim <= 320) sizeCategory = 'small';
    else if (maxDim <= 1920) sizeCategory = 'medium';
    else if (maxDim <= 3840) sizeCategory = 'large';
    else sizeCategory = 'wallpaper';

    let contentDensity: ContentAnalysis['contentDensity'] = 'moderate';
    if (w > 0 && h > 0) {
      const pixelArea = w * h;
      const bytesPerArea = fileSize / pixelArea;
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

  /**
   * 图片对比分析
   */
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
        const areaA = metaA.width * metaA.height;
        const areaB = metaB.width * metaB.height;
        dimensionDiff = `${metaA.width}x${metaA.height} (${areaA} px) vs ${metaB.width}x${metaB.height} (${areaB} px)`;
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
}

export function createImageAnalysisTool(): ImageAnalysisTool {
  return new ImageAnalysisTool();
}
