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
 * K1（知识库优化，对照 AiDGAtlas）：非结构化文档抽取器注册表
 *
 * PDF / DOCX / XLSX → 统一中间表示（IR）ExtractedDocument：
 *   - text：可进入现有 chunker / KnowledgeCompiler 管线的纯文本层
 *   - pagesText：PDF 逐页文本（K4 页码级证据回链的数据源）
 *   - locators：行区间 ↔ page/section 定位（K4 消费）
 *
 * 分发：extractDocument(path) 按扩展名路由到对应抽取器；
 * 文本类扩展名回退 utf-8 直读（保持原管线行为），无抽取器返回 null（调用方按原逻辑跳过）。
 */
import { readFile, writeFile } from 'fs/promises';
import { extname } from 'path';
import { PdfExtractor } from './PdfExtractor';
import { DocxExtractor } from './DocxExtractor';
import { XlsxExtractor } from './XlsxExtractor';
import type { ExtractedDocument } from './types';

const extractors = [
  new PdfExtractor(),
  new DocxExtractor(),
  new XlsxExtractor(),
];

/** 文档抽取器支持的可编译扩展名（供 KnowledgeCompiler.COMPILABLE_EXTENSIONS 扩展） */
export const DOCUMENT_EXTRACT_EXTS: string[] = [
  ...new Set(extractors.flatMap((e) => e.extensions)),
];

/** 纯文本扩展名（直读 utf-8，无需抽取器） */
const PLAIN_TEXT_EXTS = new Set([
  '.txt',
  '.md',
  '.json',
  '.csv',
  '.tsv',
  '.xml',
  '.yaml',
  '.yml',
]);

/**
 * K4 证据回链 sidecar：抽取时把 pagesText/locators 持久化到 {path}.locators.json，
 * 供检索期 quote→page/§ 反查（避免每次查询重新解析 PDF/DOCX/XLSX）。
 */
export async function persistExtractionSidecar(
  rawFile: string,
  extracted: ExtractedDocument
): Promise<void> {
  const hasLocators = extracted.locators.length > 0;
  const hasPagesText = (extracted.pagesText?.length ?? 0) > 0;
  if (!hasLocators && !hasPagesText) return;

  try {
    await writeFile(
      `${rawFile}.locators.json`,
      JSON.stringify({
        path: extracted.path,
        ext: extracted.ext,
        pageCount: extracted.meta.pageCount,
        charCount: extracted.meta.charCount,
        locators: extracted.locators,
        pagesText: extracted.pagesText ?? [],
      }),
      'utf-8'
    );
  } catch {
    // @ignore-catch 定位缓存失败不影响抽取主流程
  }
}

/**
 * 抽取任意源文件的统一文本层。返回 null 表示该扩展名既非文档也非文本
 * （调用方应跳过——与现有 ignore 语义一致）。
 */
export async function extractDocument(
  path: string
): Promise<ExtractedDocument | null> {
  const ext = extname(path).toLowerCase();

  const extractor = extractors.find((e) => e.extensions.includes(ext));
  if (extractor) {
    const extracted = await extractor.extract(path);
    await persistExtractionSidecar(path, extracted);
    return extracted;
  }

  if (PLAIN_TEXT_EXTS.has(ext)) {
    const text = await readFile(path, 'utf-8');
    return {
      path,
      ext,
      text,
      meta: { charCount: text.length },
      locators: [],
    };
  }

  return null;
}
