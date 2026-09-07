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
 * K1 XLSX 文本抽取器（SheetJS xlsx，纯 JS、Bun 兼容）
 *
 * 逐 sheet 转文本：首行为表头标注，其后逐行把各单元格拼为一行
 * `表头: 值`（sheet 行间以空行分隔）。行级定位通过每个 sheet 的
 * 起始行区间近似表达（精确到 sheet，不做单元格偏移）。
 */
import { readFile } from 'fs/promises';
import * as XLSX from 'xlsx';
import type { ExtractedDocument, DocumentExtractor } from './types';

export class XlsxExtractor implements DocumentExtractor {
  readonly extensions = ['.xlsx', '.xls'];

  async extract(path: string): Promise<ExtractedDocument> {
    const buf = await readFile(path);
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });

    const parts: string[] = [];
    const locators: ExtractedDocument['locators'] = [];
    let lineAcc = 1;
    const sheetCount = wb.SheetNames.length;

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        defval: '',
      }) as Array<Array<string | number | Date>>;

      const header: string[] = Array.isArray(matrix[0])
        ? matrix[0].map((c) => String(c ?? '').trim())
        : [];
      const sheetText: string[] = [`## 工作表：${sheetName}`];
      if (header.length > 0) {
        sheetText.push(`表头: ${header.join(' | ')}`);
      }
      const rowStartLine = lineAcc + sheetText.length;
      for (let r = 1; r < matrix.length; r++) {
        const row = matrix[r];
        if (!Array.isArray(row)) continue;
        const cells = header.map(
          (h, i) => `${h || `列${i + 1}`}: ${formatCell(row[i])}`
        );
        sheetText.push(cells.join('，'));
      }
      const textBlock = sheetText.join('\n');
      parts.push(textBlock);

      const blockLineCount = textBlock.length
        ? textBlock.split('\n').length
        : 0;
      locators.push({
        lineStart: rowStartLine,
        lineEnd:
          rowStartLine +
          Math.max(blockLineCount - (header.length > 0 ? 2 : 1), 0),
        tableId: sheetName,
      });
      lineAcc += blockLineCount + (sheetCount > 1 ? 2 : 0);
    }

    const text = parts.join('\n\n');
    return {
      path,
      ext: path.toLowerCase().endsWith('.xls') ? '.xls' : '.xlsx',
      text,
      meta: { charCount: text.length },
      locators,
    };
  }
}

function formatCell(v: string | number | Date | unknown): string {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  }
  if (v === null || v === undefined) return '';
  return String(v);
}
