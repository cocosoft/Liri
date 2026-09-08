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
 * R1 扫描件 PDF OCR（复用 L2 EasyOCR python worker，默认关闭）
 *
 * 触发条件（由 PdfExtractor 判定）：
 *   - pdfjs 文本层极稀薄（按页平均可见字符 < SCAN_MIN_CHARS_PER_PAGE）
 *   - 且 `KNOWLEDGE_PDF_OCR=1`（默认关，零成本；开启后依赖 L2 python worker 环境含 EasyOCR）
 *
 * 流程：media::extractPdfPages（pdftoppm，回退 pdfjs）逐页渲染 →
 *       WorkerGuard.request('ocr', { image_path, languages: ['ch_sim','en'] })
 *       → 页文本/页级 locators 组装为与 PdfExtractor 一致的 IR。
 *
 * 失败即抛错：编译侧走"失败跳过、下次调度自愈"，不产出残缺 wiki 页。
 */
import { dirname } from 'path';
import { rm } from 'fs/promises';
import { WorkerGuard } from '@modules/ai';
import { getLogger } from '@modules/monitoring';
import { extractPdfPages } from '../../../media/pdf/PdfPageExtractor';
import { isKnowledgeOcrEnabled } from '@modules/knowledge/KnowledgeConfig';
import type { ExtractedDocument } from './types';

const logger = getLogger('knowledge:ingest:pdf-ocr');

/** 判定阈值：平均每页可见字符数低于此值视为扫描件 */
export const SCAN_MIN_CHARS_PER_PAGE = 15;

/** OCR 语言（与 ImageAnalysisTool L2 EasyOCR 默认一致） */
const OCR_LANGUAGES = ['ch_sim', 'en'];

/** OCR 渲染 DPI */
const OCR_RENDER_DPI = 150;

/** 是否启用扫描件 OCR（运行时开关：env KNOWLEDGE_PDF_OCR > knowledge.json ocrEnabled > false） */
export function isPdfOcrEnabled(): boolean {
  return isKnowledgeOcrEnabled();
}

/**
 * 扫描件判定（纯函数，供单测）
 * @param text  pdfjs 文本层全文
 * @param pageCount 页数
 */
export function requiresOcr(text: string, pageCount: number): boolean {
  const visible = text.replace(/\s/g, '').length;
  if (pageCount <= 0) return visible === 0;
  return visible === 0 || visible / pageCount < SCAN_MIN_CHARS_PER_PAGE;
}

/** 懒加载 L2 worker（单例复用，避免重复拉起 python 进程） */
let ocrGuard: WorkerGuard | null = null;
function getOcrGuard(): WorkerGuard {
  if (!ocrGuard) {
    ocrGuard = new WorkerGuard();
  }
  return ocrGuard;
}

interface OcrWorkerResult {
  text: string;
  blocks?: unknown[];
}

/**
 * 扫描件 OCR 抽取：渲染每页 → L2 OCR → 组装页文本与页级 locators
 */
export async function ocrExtractPdf(
  pdfPath: string
): Promise<ExtractedDocument> {
  const guard = getOcrGuard();
  const pages = await extractPdfPages(pdfPath, {
    format: 'jpeg',
    dpi: OCR_RENDER_DPI,
  });
  if (pages.length === 0) {
    throw new Error(`OCR 页渲染为空：${pdfPath}`);
  }

  const outputDir = dirname(pages[0].imagePath);
  const pagesText: string[] = [];
  try {
    for (const page of pages) {
      let pageText = '';
      try {
        const result = await guard.request<OcrWorkerResult>('ocr', {
          image_path: page.imagePath,
          languages: OCR_LANGUAGES,
        });
        pageText = (result?.text ?? '').trim();
      } catch (err) {
        // 单页失败直接上抛（编译侧跳过自愈），避免半残文档入库
        throw new Error(
          `PDF 第 ${page.pageNumber} 页 OCR 失败：${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
      pagesText.push(pageText);
      logger.info('PDF OCR 页完成', {
        pdfPath,
        page: page.pageNumber,
        pageCharCount: pageText.length,
      });
    }
  } finally {
    // 清理渲染临时目录
    try {
      await rm(outputDir, { recursive: true, force: true });
    } catch {
      // 清理失败不阻断
    }
  }

  // 页级行区间定位（与 PdfExtractor 同规则；页从 1 起）
  const locators: ExtractedDocument['locators'] = [];
  let lineAcc = 1;
  for (let i = 0; i < pagesText.length; i++) {
    const pageLineCount = pagesText[i].length
      ? pagesText[i].split('\n').length
      : 0;
    locators.push({
      lineStart: lineAcc,
      lineEnd: pageLineCount > 0 ? lineAcc + pageLineCount - 1 : lineAcc,
      page: i + 1,
    });
    lineAcc += pageLineCount + (i < pagesText.length - 1 ? 2 : 0);
  }

  const text = pagesText.join('\n\n');
  logger.info('PDF OCR 完成', {
    pdfPath,
    pageCount: pages.length,
    charCount: text.length,
  });
  return {
    path: pdfPath,
    ext: '.pdf',
    text,
    pagesText,
    locators,
    meta: {
      pageCount: pages.length,
      charCount: text.length,
    },
  };
}
