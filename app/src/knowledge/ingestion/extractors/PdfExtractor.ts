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
 * K1 PDF 文本抽取器（pdfjs-dist，纯 JS、Bun 兼容）
 *
 * 产出逐页文本（pagesText）与页级行区间定位（locators，K4 消费）。
 * 文本型 PDF 直接用；扫描件（抽取文本过少）返回 text 为空串，由调用方
 * 决定是否触发 OCR（OCR 预留，默认关闭）。
 */
import { readFile } from 'fs/promises';
import { createRequire } from 'module';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { ExtractedDocument, DocumentExtractor } from './types';

const require = createRequire(import.meta.url);

function resolveWorkerSrc(): string {
  try {
    return require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  } catch {
    return '';
  }
}

export class PdfExtractor implements DocumentExtractor {
  readonly extensions = ['.pdf'];

  async extract(path: string): Promise<ExtractedDocument> {
    const workerSrc = resolveWorkerSrc();
    if (workerSrc) GlobalWorkerOptions.workerSrc = workerSrc;

    const buf = await readFile(path);
    const loadingTask = getDocument({
      data: new Uint8Array(buf),
      disableFontFace: true,
      useSystemFonts: true,
      verbosity: 0,
    });

    let pdf;
    try {
      pdf = await loadingTask.promise;
      const pageCount = pdf.numPages;
      const pagesText: string[] = [];
      for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        // pdf.js 文本项：hasEOL 表示换行，否则空格分隔
        let pageText = '';
        for (const item of content.items) {
          if ('str' in item) {
            pageText += item.str;
            pageText += (item as { hasEOL?: boolean }).hasEOL ? '\n' : ' ';
          }
        }
        pagesText.push(pageText.trim());
        // 释放页对象内存
        page.cleanup();
      }

      // 页级行区间定位（文本层逐页以 \n\n 连接；页从 1 起）
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
        // 页间分隔 \n\n 占 2 行
        lineAcc += pageLineCount + (i < pagesText.length - 1 ? 2 : 0);
      }

      const text = pagesText.join('\n\n');
      return {
        path,
        ext: '.pdf',
        text,
        pagesText,
        locators,
        meta: {
          pageCount,
          charCount: text.length,
        },
      };
    } finally {
      try {
        await loadingTask.destroy();
        pdf?.destroy?.();
      } catch {
        // 销毁失败不阻断
      }
    }
  }
}
