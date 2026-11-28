/**
 * CanvasInstance
 * 管理单个画布的状态 (尺寸、元素列表) 与导出渲染
 * 使用 Sharp 处理图片 I/O 和格式转换，使用 SVG 层渲染图形/文字
 */

import { loadSharp } from '@openliri/infra/utils/externalDeps';
// C1（2026-10-09）：canvas id 熵源改用 crypto
import { randomIdSuffix } from '@openliri/infra/utils/common';
import { resolveOutputDir } from '@openliri/infra/environment';
import { getLogger } from '@openliri/infra/monitoring';
const logger = getLogger('tools:canvas');

/** 惰性加载 sharp（编译产物中 external，不能顶层 import） */
function getSharp(): typeof import('sharp') {
  return loadSharp();
}

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
      // 2026-11-28（真机 `[export] Input buffer contains unsupported image format`）：
      // `src` 必须是**路径字符串**。模型偶尔传对象/数组 ⇒ `escapeXml` 会抛
      // `String.prototype.replace is not a function`，且坏元素会把整张画布导出拖垮。
      if (!elem.src || typeof elem.src !== 'string') return '';
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
 * 图片元素**尺寸**归一化（系统边界校验：模型可传 0 / 负数 / NaN / 字符串）。
 *
 * 非法值退回默认尺寸 —— 直接把 0/NaN 交给 sharp 会产出空图，进而在
 * `pipeline.toBuffer()` 报 `Input buffer contains unsupported image format`
 * （2026-11-28 真机 `tools:canvas [export]`）。
 */
function safeSize(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

/** 图片元素**坐标**归一化（sharp 要求非负整数，`undefined`/`NaN` 会直接报参数错误） */
function safeCoord(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
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
    this.canvasId = `canvas_${Date.now()}_${randomIdSuffix(6)}`;
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

    // 2026-11-28 真机（`tools:canvas [export] Input buffer contains unsupported image format`）：
    // **SVG 导出不需要任何位图渲染** —— 旧流程先建 sharp 画布、再用自己生成的 SVG 叠层
    // 走 composite，而 composite 处理 SVG 依赖 libvips 的 librsvg 支持；缺该支持的环境里
    // 只要画布含矩形/文字（几乎必然），导出就整单失败。直接出文档既正确也零依赖。
    if (format === 'svg') {
      return Buffer.from(this.toSvgString());
    }

    // 分类元素：图片元素单独用 Sharp 处理，非图片元素用 SVG 层
    // 2026-11-28：`src` 非字符串（模型传对象）不算图片元素 —— 否则 sharp 会一路吃到
    // `pipeline.toBuffer()` 才报 `Input buffer contains unsupported image format`。
    const imageElements = this.elements.filter(
      (e) => e.type === 'image' && typeof e.src === 'string' && e.src.length > 0
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
    let pipeline = getSharp()({
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
        const buf = await getSharp()(elem.src!)
          .resize(safeSize(elem.width, 100), safeSize(elem.height, 100))
          // 2026-11-28：`toBuffer()` 不指定输出格式时 sharp 返回**原始像素**，
          // 作为 `composite({input})` 输入会报 `Input buffer contains unsupported image format`
          // ⇒ 图片元素其实**从未**合成成功（被下方 catch 静默吞掉）。必须先编码成 PNG。
          .png()
          .toBuffer();
        // 尺寸归一化后仍可能是空图（源文件损坏 / 极端尺寸）⇒ 跳过该元素而不是让
        // `pipeline.toBuffer()` 整张失败（真机该错误文案即来自 composite 的非法输入）。
        if (buf.length === 0) {
          logger.warn('CanvasInstance · 图片元素为空，跳过 composite', {
            canvasId: this.canvasId,
            src: elem.src,
          });
          continue;
        }
        pipeline = pipeline.composite([
          {
            input: buf,
            top: safeCoord(elem.y),
            left: safeCoord(elem.x),
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

    // 2026-11-28：`toBuffer()` 不带输出格式 ⇒ sharp 返回**原始像素缓冲**（width×height×channels），
    // 再喂回 sharp 做 composite / 格式转换就会报
    // `Input buffer contains unsupported image format`（真机 `tools:canvas [export]`，
    // 空画布也会失败）。必须先编码成 PNG 再进入后续管道。
    let result = await pipeline.png().toBuffer();

    // SVG overlay 叠加到画布上
    // 2026-11-28：叠加层失败（环境缺 librsvg / SVG 内容非法）**降级**为"不含矢量层"的
    // 结果并留痕 —— 整单失败会让用户连底色与已合成图片都拿不到（CS03：外部能力缺失可降级）。
    if (svgOverlay) {
      try {
        const svgBuf = Buffer.from(svgOverlay);
        result = await getSharp()(result)
          .composite([{ input: svgBuf, top: 0, left: 0 }])
          .toBuffer();
      } catch (err) {
        logger.warn('CanvasInstance · SVG 叠加层渲染失败，返回无矢量层的结果', {
          canvasId: this.canvasId,
          error: String(err),
        });
      }
    }

    // 格式转换（`svg` 已在上方直接返回）
    switch (format) {
      case 'png':
        return getSharp()(result)
          .png({ quality: quality ?? 90 })
          .toBuffer();
      case 'jpeg':
        return getSharp()(result)
          .jpeg({ quality: quality ?? 90 })
          .toBuffer();
      case 'webp':
        return getSharp()(result)
          .webp({ quality: quality ?? 90 })
          .toBuffer();
      default:
        return getSharp()(result).png().toBuffer();
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
