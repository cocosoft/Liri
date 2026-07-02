// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * ImageInputRouter — 图像输入智能路由
 *
 * 根据主模型能力和图片属性，自动决定图片如何处理：
 * - native: 直传主模型（多模态注入）
 * - vision: 调用专用 Vision API 分析
 * - local: 本地分析（L1/L2）
 * - auto: 自动选择（vision 优先，失败回退 local）
 *
 * 参照：
 * - hermes hermes/agent/image_routing.py（native/text 双模式）
 * - openclaw src/media-understanding/runner.ts（vision 原生跳过优化）
 */

import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'tools:image-input-router',
});

// ============================================================
// 类型定义
// ============================================================

/** 图像输入模式 */
export type ImageInputMode = 'native' | 'vision' | 'local' | 'auto';

/** 图像来源 */
export interface ImageSource {
  /** 图片数据 */
  buffer: Buffer;
  /** MIME 类型 */
  mimeType: string;
  /** 原始来源标识（路径/URL/clipboard） */
  source?: string;
  /** 文件大小（字节） */
  fileSize?: number;
}

/** 路由上下文 */
export interface RouteContext {
  /** 主模型是否支持 vision */
  mainModelSupportsVision: boolean;
  /** 用户是否配置了专用视觉模型 */
  hasDedicatedVisionModel: boolean;
  /** 是否需要 OCR */
  needsOcr?: boolean;
  /** 是否需要目标检测 */
  needsObjectDetection?: boolean;
  /** 是否需要相似度分析 */
  needsSimilarity?: boolean;
  /** Vision API 最大图片大小限制（字节） */
  maxVisionBytes?: number;
}

/** 路由决策 */
export interface ImageInputDecision {
  mode: ImageInputMode;
  reason: string;
  /** Vision API 使用的 Provider ID */
  visionProvider?: string;
}

// ============================================================
// 路由实现
// ============================================================

/** 默认 Vision API 最大图片大小：20MB */
const DEFAULT_MAX_VISION_BYTES = 20 * 1024 * 1024;

export class ImageInputRouter {
  /**
   * 根据主模型能力和图片属性，自动决定图片如何处理
   *
   * 决策逻辑（优先级从高到低）：
   * 1. 主模型支持 vision → 'native'（参照 openclaw 的 vision 原生跳过优化）
   * 2. 需要 OCR/检测/相似度 → 'local' 分流到 L1/L2
   * 3. 用户配置了专用视觉模型 → 'vision'
   * 4. 图片 ≤ 限制且无特殊分析需求 → 'native'
   * 5. 其他 → 'auto'（vision 优先，失败回退 native）
   */
  route(image: ImageSource, context: RouteContext): ImageInputDecision {
    const sizeMB = image.fileSize
      ? (image.fileSize / (1024 * 1024)).toFixed(1)
      : '未知';

    // 决策 1: 主模型原生支持 vision → 直传（避免冗余 API 调用）
    if (context.mainModelSupportsVision) {
      logger.info('ImageInputRouter · 主模型支持 vision，采用 native 模式', {
        source: image.source,
        mimeType: image.mimeType,
        sizeMB,
      });
      return {
        mode: 'native',
        reason: '主模型原生支持视觉，图片直接注入模型上下文',
      };
    }

    // 决策 2: 需要本地计算机视觉能力 → 分流到 L1/L2
    if (
      context.needsOcr ||
      context.needsObjectDetection ||
      context.needsSimilarity
    ) {
      const needs = [
        context.needsOcr && 'OCR',
        context.needsObjectDetection && '目标检测',
        context.needsSimilarity && '相似度分析',
      ]
        .filter(Boolean)
        .join('+');

      logger.info('ImageInputRouter · 需要本地 CV 能力，采用 local 模式', {
        source: image.source,
        needs,
      });
      return {
        mode: 'local',
        reason: `需要 ${needs} 能力，分流到本地 L1/L2 分析层`,
      };
    }

    // 决策 3: 用户配置了专用视觉模型 → vision
    if (context.hasDedicatedVisionModel) {
      logger.info('ImageInputRouter · 已配置专用视觉模型，采用 vision 模式', {
        source: image.source,
      });
      return {
        mode: 'vision',
        reason: '已配置专用视觉模型，使用 Vision API 分析',
      };
    }

    // 决策 4: 主模型不支持 vision 且无专用模型
    // → auto 模式：先尝试 vision（如有可用 Provider），失败回退 local
    const maxBytes = context.maxVisionBytes || DEFAULT_MAX_VISION_BYTES;
    const fitsLimit = !image.fileSize || image.fileSize <= maxBytes;

    if (fitsLimit) {
      logger.info('ImageInputRouter · 采用 auto 模式', {
        source: image.source,
        sizeMB,
        maxMB: (maxBytes / (1024 * 1024)).toFixed(0),
      });
      return {
        mode: 'auto',
        reason: '主模型不支持 vision，尝试 Vision API（失败回退本地分析）',
      };
    }

    // 图片过大 → 只能本地分析（L1 元数据/色彩/内容）
    logger.info('ImageInputRouter · 图片过大，采用 local 模式', {
      source: image.source,
      sizeMB,
      maxMB: (maxBytes / (1024 * 1024)).toFixed(0),
    });
    return {
      mode: 'local',
      reason: `图片大小 ${sizeMB}MB 超过 Vision API 限制 ${(maxBytes / (1024 * 1024)).toFixed(0)}MB，使用本地分析`,
    };
  }

  /**
   * 响应式图片缩放
   *
   * 当 Vision API 因图片过大拒绝时，逐级缩小后重试。
   * 参照 hermes vision_tools.py _try_shrink_image_parts_in_messages
   *
   * 缩放序列：2048 → 1600 → 1024 → 800 → 600（直到 API 接受）
   */
  async shrinkIfNeeded(
    image: Buffer,
    maxBytes: number
  ): Promise<{ buffer: Buffer; shrunk: boolean }> {
    const currentSize = image.length;

    if (currentSize <= maxBytes) {
      return { buffer: image, shrunk: false };
    }

    logger.info('ImageInputRouter · 图片需缩放', {
      currentSize: `${(currentSize / 1024).toFixed(0)}KB`,
      maxSize: `${(maxBytes / 1024).toFixed(0)}KB`,
    });

    // 逐级缩放
    const sizes = [2048, 1600, 1024, 800, 600];

    for (const maxSide of sizes) {
      try {
        const { default: sharp } = await import('sharp');

        const resized = await sharp(image)
          .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();

        const newSize = resized.length;

        logger.debug('ImageInputRouter · 缩放尝试', {
          maxSide,
          newSize: `${(newSize / 1024).toFixed(0)}KB`,
          originalSize: `${(currentSize / 1024).toFixed(0)}KB`,
        });

        if (newSize <= maxBytes) {
          logger.info('ImageInputRouter · 缩放成功', {
            maxSide,
            newSize: `${(newSize / 1024).toFixed(0)}KB`,
            reductionPct: `${((1 - newSize / currentSize) * 100).toFixed(0)}%`,
          });
          return { buffer: resized, shrunk: true };
        }
      } catch (err) {
        logger.warn('ImageInputRouter · 缩放失败，尝试更小尺寸', {
          maxSide,
          error: (err as Error).message,
        });
      }
    }

    // 极端压缩：400px + JPEG quality 60
    try {
      const { default: sharp } = await import('sharp');
      const extreme = await sharp(image)
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 60 })
        .toBuffer();

      logger.warn('ImageInputRouter · 使用极端压缩', {
        extremeSize: `${(extreme.length / 1024).toFixed(0)}KB`,
      });
      return { buffer: extreme, shrunk: true };
    } catch {
      logger.error('ImageInputRouter · 极端压缩失败，返回原图');
      return { buffer: image, shrunk: false };
    }
  }
}
