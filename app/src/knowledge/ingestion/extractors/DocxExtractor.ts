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
 * K1 DOCX 文本抽取器（mammoth，纯 JS、Bun 兼容）
 *
 * 文本层：extractRawText 还原段落文本（表格单元格按顺序并入正文）。
 * 表格结构化还原（表头语义）与段落级定位属 K4/K1b，文本层先行。
 */
import { extractRawText } from 'mammoth';
import type { ExtractedDocument, DocumentExtractor } from './types';

export class DocxExtractor implements DocumentExtractor {
  readonly extensions = ['.docx'];

  async extract(path: string): Promise<ExtractedDocument> {
    const result = await extractRawText({ path });
    const text = (result.value ?? '').trim();
    return {
      path,
      ext: '.docx',
      text,
      meta: { charCount: text.length },
      locators: [],
    };
  }
}
