/**
 * CanvasInstance
 * 管理单个画布的状态 (尺寸、元素列表) 与导出渲染
 * 使用 Sharp 处理图片 I/O 和格式转换，使用 SVG 层渲染图形/文字
 */

import sharp from 'sharp';
import { resolveOutputDir } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:canvas');

/** 支持的画布元素类型 */
export interface CanvasElement {
  type: 'rect' | 'circle' | 'line' | 'text' | 'image' | 'path';
  x: number;
  y: number;
  width?: number;
  height?: number;
  radius?: number;
  color?: string;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  rotation?: number;
  opacity?: number;
  points?: Array<{ x: number; y: number }>;
  src?: string;
}

/** 画布配置 */
export interface CanvasConfig {
  width: number;
  height: number;
  backgroundColor?: string;
}

/** 导出选项 */
export interface ExportOptions {
  format: 'png' | 'jpeg' | 'webp' | 'svg';
  quality?: number;
}

/**
 * 将 CanvasElement 转换为 SVG 元素字符串
 * 通过嵌入 SVG 片段到 Sharp 管道实现渲染
 */
function elementToSvg(elem: CanvasElement): string {
  const { type } = elem;
  const opacity =
    elem.opacity !== undefined ? ` opacity="${elem.opacity}"` : '';

  switch (type) {
    case 'rect': {
      const w = elem.width ?? 0;
      const h = elem.height ?? 0;
      const fill = elem.fillColor ?? 'none';
      const stroke = elem.strokeColor ?? 'none';
      const sw = elem.strokeWidth ?? 0;
      return `<rect x="${elem.x}" y="${elem.y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${opacity} />`;
    }

    case 'circle': {
      const r = elem.radius ?? 0;
      const fill = elem.fillColor ?? 'none';
      const stroke = elem.strokeColor ?? 'none';
      const sw = elem.strokeWidth ?? 0;
      return `<circle cx="${elem.x}" cy="${elem.y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${opacity} />`;
    }

    case 'line': {
      const pts = elem.points ?? [];
      const x2 = pts.length >= 2 ? pts[1].x : elem.x;
      const y2 = pts.length >= 2 ? pts[1].y : elem.y;
      const color = elem.strokeColor ?? elem.color ?? '#000';
      const sw = elem.strokeWidth ?? 1;
      return `<line x1="${elem.x}" y1="${elem.y}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${sw}"${opacity} />`;
    }

    case 'text': {
      const fill = elem.fillColor ?? elem.color ?? '#000';
      const fs = elem.fontSize ?? 16;
      const ff = elem.fontFamily ?? 'sans-serif';
      const text = escapeXml(elem.text ?? '');
      return `<text x="${elem.x}" y="${elem.y}" fill="${fill}" font-size="${fs}" font-family="${ff}"${opacity}>${text}</text>`;
    }

    case 'path': {
      const pts = elem.points ?? [];
      if (pts.length === 0) return '';
      const d =
        pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ') +
        ' Z';
      const fill = elem.fillColor ?? 'none';
      const stroke = elem.strokeColor ?? 'none';
      const sw = elem.strokeWidth ?? 1;
      return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${opacity} />`;
    }

    case 'image': {
      if (!elem.src) return '';
      const w = elem.width ?? 100;
      const h = elem.height ?? 100;
      return `<image x="${elem.x}" y="${elem.y}" width="${w}" height="${h}" href="${escapeXml(elem.src)}"${opacity} />`;
    }

    default:
      return '';
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * CanvasInstance
 * 持有单个画布的完整状态，仅在 export 时渲染
 */
export class CanvasInstance {
  readonly canvasId: string;
  readonly width: number;
  readonly height: number;
  private backgroundColor: string;
  private elements: CanvasElement[];
  private createdAt: number;
  private lastAccessedAt: number;

  constructor(config: CanvasConfig) {
    this.canvasId = `canvas_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.width = config.width;
    this.height = config.height;
    this.backgroundColor = config.backgroundColor ?? '#ffffff';
    this.elements = [];
    this.createdAt = Date.now();
    this.lastAccessedAt = Date.now();
  }

  /** 返回创建到现在的时间（ms） */
  get ageMs(): number {
    return Date.now() - this.createdAt;
  }

  /** 返回上次访问到现在的时间（ms） */
  get idleMs(): number {
    return Date.now() - this.lastAccessedAt;
  }

  /** 更新最后访问时间 */
  touch(): void {
    this.lastAccessedAt = Date.now();
  }

  /** 添加元素到画布 */
  addElements(elements: CanvasElement[]): void {
    this.elements.push(...elements);
    this.touch();
  }

  /** 获取元素数量 */
  get elementCount(): number {
    return this.elements.length;
  }

  /**
   * 将画布渲染为指定格式的 Buffer
   * 工作流程：
   * 1. 按元素类型分组：image 类用 Sharp composite，shape/text 类用 SVG 层
   * 2. 先创建底色画布 → composite 图片元素 → SVG overlay 渲染图形/文字
   * 3. 按目标格式输出
   */
  async export(options: ExportOptions): Promise<Buffer> {
    this.touch();
    const { format, quality } = options;

    // 分类元素：图片元素单独用 Sharp 处理，非图片元素用 SVG 层
    const imageElements = this.elements.filter(
      (e) => e.type === 'image' && e.src
    );
    const svgElements = this.elements.filter(
      (e) => e.type !== 'image' || !e.src
    );

    // 构建 SVG overlay（仅当有非图片元素时）
    const svgOverlay =
      svgElements.length > 0
        ? `<svg width="${this.width}" height="${this.height}" xmlns="http://www.w3.org/2000/svg">
           <rect width="100%" height="100%" fill="none" />
           ${svgElements.map(elementToSvg).join('\n')}
         </svg>`
        : null;

    // 创建底色
    let pipeline = sharp({
      create: {
        width: this.width,
        height: this.height,
        channels: 4,
        background: hexToRgba(this.backgroundColor),
      },
    });

    // Composite 图片元素（逐个叠加）
    for (const elem of imageElements) {
      try {
        const buf = await sharp(elem.src!)
          .resize(elem.width ?? 100, elem.height ?? 100)
          .toBuffer();
        pipeline = pipeline.composite([
          {
            input: buf,
            top: elem.y,
            left: elem.x,
          },
        ]);
      } catch (err) {
        logger.warn('CanvasInstance · 图片元素 composite 失败', {
          canvasId: this.canvasId,
          src: elem.src,
          error: String(err),
        });
      }
    }

    let result = await pipeline.toBuffer();

    // SVG overlay 叠加到画布上
    if (svgOverlay) {
      const svgBuf = Buffer.from(svgOverlay);
      result = await sharp(result)
        .composite([{ input: svgBuf, top: 0, left: 0 }])
        .toBuffer();
    }

    // 格式转换
    switch (format) {
      case 'png':
        return sharp(result)
          .png({ quality: quality ?? 90 })
          .toBuffer();
      case 'jpeg':
        return sharp(result)
          .jpeg({ quality: quality ?? 90 })
          .toBuffer();
      case 'webp':
        return sharp(result)
          .webp({ quality: quality ?? 90 })
          .toBuffer();
      case 'svg':
        // SVG 直接输出：生成完整 SVG 文档
        return Buffer.from(this.toSvgString());
      default:
        return sharp(result).png().toBuffer();
    }
  }

  /** 生成完整 SVG 字符串（用于 SVG 格式导出） */
  toSvgString(): string {
    const elements = this.elements.map(elementToSvg).join('\n');
    return `<svg width="${this.width}" height="${this.height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="${this.backgroundColor}" />
  ${elements}
</svg>`;
  }
}

/** 将 hex 颜色转为 RGBA 对象 */
function hexToRgba(hex: string): {
  r: number;
  g: number;
  b: number;
  alpha: number;
} {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return { r, g, b, alpha: 1 };
  }
  if (clean.length >= 6) {
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return { r, g, b, alpha: 1 };
  }
  return { r: 255, g: 255, b: 255, alpha: 1 };
}
