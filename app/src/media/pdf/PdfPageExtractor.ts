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
 * PdfPageExtractor — PDF 页面提取为图片
 *
 * 使用 pdftoppm (poppler-utils) 将 PDF 页面渲染为 JPEG 图片。
 * 若 pdftoppm 不可用，回退到 pdf.js 纯 JS 方案。
 *
 * 参照 cc_code backend/utils/pdf.ts
 */

import { getLogger } from '@modules/monitoring';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { resolveTempDir } from '@modules/core/paths';

const logger = getLogger('media:pdf-extractor');

/** 提取的单页图片 */
export interface ExtractedPage {
  pageNumber: number;
  imagePath: string;
  format: string;
  width?: number;
  height?: number;
}

/** 提取选项 */
export interface PdfExtractOptions {
  /** 起始页码（从 1 开始） */
  startPage?: number;
  /** 结束页码 */
  endPage?: number;
  /** DPI（默认 100） */
  dpi?: number;
  /** 输出格式（默认 jpeg） */
  format?: 'jpeg' | 'png';
  /** 最大 PDF 文件大小（字节，默认 100MB） */
  maxFileSize?: number;
}

const DEFAULT_MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

/**
 * 从 PDF 提取页面为图片
 * @param pdfPath PDF 文件路径
 * @param options 提取选项
 * @returns 提取的页面列表
 */
export async function extractPdfPages(
  pdfPath: string,
  options: PdfExtractOptions = {}
): Promise<ExtractedPage[]> {
  // 检查文件
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF 文件不存在: ${pdfPath}`);
  }

  const stat = fs.statSync(pdfPath);
  const maxSize = options.maxFileSize || DEFAULT_MAX_FILE_SIZE;
  if (stat.size > maxSize) {
    throw new Error(
      `PDF 文件过大: ${(stat.size / 1024 / 1024).toFixed(1)}MB，最大支持 ${(maxSize / 1024 / 1024).toFixed(0)}MB`
    );
  }

  const dpi = options.dpi || 100;
  const format = options.format || 'jpeg';
  const outputDir = path.join(resolveTempDir(), 'pdf-pages', randomUUID());

  logger.info('PdfPageExtractor · 开始提取', {
    pdfPath,
    dpi,
    format,
    fileSize: `${(stat.size / 1024 / 1024).toFixed(1)}MB`,
  });

  // 尝试 pdftoppm
  try {
    return extractWithPdfToPpm(pdfPath, outputDir, dpi, format, options);
  } catch (err) {
    logger.warn('PdfPageExtractor · pdftoppm 不可用，尝试 pdf.js', {
      error: (err as Error).message,
    });
    // 回退到 pdf.js（如果已安装）
    try {
      return await extractWithPdfJs(pdfPath, outputDir, dpi, format, options);
    } catch (err2) {
      throw new Error(
        `PDF 页面提取失败：pdftoppm 和 pdf.js 均不可用。${(err2 as Error).message}`
      );
    }
  }
}

/** 使用 pdftoppm 提取（cc_code 方案） */
function extractWithPdfToPpm(
  pdfPath: string,
  outputDir: string,
  dpi: number,
  format: string,
  options: PdfExtractOptions
): ExtractedPage[] {
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPrefix = path.join(outputDir, 'page');

  const args: string[] = [`-r`, String(dpi), `-${format}`];

  if (options.startPage) args.push('-f', String(options.startPage));
  if (options.endPage) args.push('-l', String(options.endPage));

  args.push(pdfPath, outputPrefix);

  const cmd = `pdftoppm ${args.map((a) => `"${a}"`).join(' ')}`;

  try {
    execSync(cmd, { timeout: 60000, stdio: 'pipe' });
  } catch (err) {
    // 检测密码保护
    const stderr = (err as { stderr?: Buffer })?.stderr?.toString() || '';
    if (stderr.includes('password') || stderr.includes('encrypted')) {
      throw new Error('PDF 文件受密码保护，无法提取页面');
    }
    throw new Error(`pdftoppm 执行失败: ${stderr || (err as Error).message}`);
  }

  // 收集输出文件
  const files = fs
    .readdirSync(outputDir)
    .filter((f) => f.startsWith('page-'))
    .sort();

  return files.map((f) => {
    const match = f.match(/page-(\d+)/);
    return {
      pageNumber: match ? parseInt(match[1], 10) : 0,
      imagePath: path.join(outputDir, f),
      format: path.extname(f).replace('.', ''),
    };
  });
}

/** 使用 pdf.js 提取（纯 JS 回退方案） */
async function extractWithPdfJs(
  pdfPath: string,
  outputDir: string,
  dpi: number,
  format: string,
  options: PdfExtractOptions
): Promise<ExtractedPage[]> {
  // 动态导入 pdf.js（使用 legacy 构建，与 PdfConverter 保持一致）
  let pdfjsModule: unknown;
  try {
    pdfjsModule = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch {
    throw new Error('pdf.js 未安装。运行: bun add pdfjs-dist');
  }
  const lib = pdfjsModule as unknown as Record<string, Function>;
  const OPS = (lib.OPS ?? {}) as unknown as Record<string, number>;
  const GlobalWorkerOptions = (lib.GlobalWorkerOptions ?? {}) as unknown as {
    workerSrc?: string;
  };

  // R1/J3：显式指定 worker + 注入 @napi-rs/canvas 工厂与兼容参数——
  // Bun/Node 下 pdfjs 对图像型 PDF 的 worker 解码/回传不可靠（曾致渲染全透明→黑图），
  // 此配置尽力走主线程路径并避免 worker 崩溃噪音；仍失败时由下方空绘检测显式抛错。
  try {
    GlobalWorkerOptions.workerSrc =
      require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  } catch {
    // worker 解析失败不阻断（pdfjs 内部回退）
  }
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvasFactory = {
    create(width: number, height: number) {
      const canvas = createCanvas(
        Math.max(1, Math.floor(width)),
        Math.max(1, Math.floor(height))
      );
      return { canvas, context: canvas.getContext('2d') };
    },
    reset(ctx: unknown, width: number, height: number) {
      const c = (ctx as { canvas: { width: number; height: number } }).canvas;
      c.width = Math.max(1, Math.floor(width));
      c.height = Math.max(1, Math.floor(height));
    },
    destroy() {
      // @napi-rs/canvas 无需显式释放
    },
  };

  fs.mkdirSync(outputDir, { recursive: true });

  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await (
    lib.getDocument({
      data,
      canvasFactory,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
    }) as unknown as {
      promise: Promise<Record<string, unknown>>;
    }
  ).promise;
  const pdoc = doc as unknown as Record<string, unknown>;

  const totalPages = pdoc.numPages as number;
  const startPage = Math.max(1, options.startPage || 1);
  const endPage = Math.min(totalPages, options.endPage || totalPages);

  const pages: ExtractedPage[] = [];
  const scale = dpi / 72;

  // Canvas 使用 @napi-rs/canvas 或 node-canvas（需要运行时支持）
  for (let i = startPage; i <= endPage; i++) {
    const page = (await (pdoc.getPage as Function)(i)) as unknown as Record<
      string,
      Function
    >;
    const viewport = (page.getViewport as Function)({
      scale,
    }) as unknown as Record<string, unknown>;

    const width = Math.floor(viewport.width as number) || 1;
    const height = Math.floor(viewport.height as number) || 1;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    await (page.render as Function)({ canvasContext: ctx, viewport });

    // R1/J3：图像页空绘检测——pdfjs 在 Bun 下对图像型 PDF 可能解析不出图片对象，
    // render 返回但画布全透明（转 JPEG 即全黑）。含图像 op 却几乎没有不透明像素 → 判定渲染失败。
    let opList: { fnArray: number[] } | null = null;
    try {
      opList = (await (page.getOperatorList as Function)()) as {
        fnArray: number[];
      };
    } catch {
      opList = null;
    }
    const hasImageOp =
      opList !== null &&
      opList.fnArray.some(
        (fn) =>
          fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject
      );
    if (hasImageOp) {
      let opaquePixels = 0;
      let sampled = 0;
      const imgData = ctx.getImageData(0, 0, width, height) as {
        data: Uint8ClampedArray;
      };
      const step = Math.max(1, Math.floor(Math.min(width, height) / 64));
      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          if (imgData.data[(y * width + x) * 4 + 3] > 0) opaquePixels++;
          sampled++;
        }
      }
      if (opaquePixels / Math.max(1, sampled) < 0.005) {
        throw new Error(
          `pdf.js 渲染第 ${i} 页图像失败：未绘制出内容（图像对象解码/回传在 Bun/Node 下不可用）。` +
            '请安装 poppler-utils（提供 pdftoppm）以保证 R1 扫描件 OCR 的页渲染可用。'
        );
      }
    }
    page.cleanup?.();

    const ext = format === 'png' ? 'png' : 'jpg';
    const imagePath = path.join(
      outputDir,
      `page-${String(i).padStart(2, '0')}.${ext}`
    );

    const buffer = (
      canvas as unknown as { toBuffer: (type: string) => Buffer }
    ).toBuffer(format === 'png' ? 'image/png' : 'image/jpeg');
    fs.writeFileSync(imagePath, buffer);

    pages.push({
      pageNumber: i,
      imagePath,
      format: ext,
      width: viewport.width as number,
      height: viewport.height as number,
    });
  }

  return pages;
}
