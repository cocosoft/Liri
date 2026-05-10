import { HtmlConverter } from './HtmlConverter';
import type { ConversionResult, ConversionContext } from '../engine/types';
import { PRIORITY_SPECIFIC_FILE_FORMAT } from '../engine/types';
import { AppError } from '@modules/error/types';
import { ErrorCodes } from '@modules/error/ErrorCodes';

let _depError: Error | null = null;
let _xlsx: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _xlsx = require('xlsx');
} catch (e) {
  _depError = e as Error;
}

export class XlsConverter extends HtmlConverter {
  override readonly name = 'xls';
  override readonly priority = PRIORITY_SPECIFIC_FILE_FORMAT;
  override readonly supportedExtensions = ['.xls'];
  override readonly supportedMimeTypes = [
    'application/vnd.ms-excel',
  ];

  override async convert(context: ConversionContext): Promise<ConversionResult> {
    if (_depError) {
      throw AppError.fromCode(ErrorCodes.MISSING_DEPENDENCY, {
        context: { dependency: 'xlsx', format: 'xls', note: '运行：npm install xlsx' },
        cause: _depError,
      });
    }

    const buffer = typeof context.content === 'string'
      ? Buffer.from(context.content, 'utf-8')
      : context.content;

    const workbook = _xlsx.read(buffer, { type: 'buffer' });
    const parts: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const html = this.sheetToHtml(sheet);
      const md = this.convertString(html);
      parts.push(`## ${sheetName}\n\n${md}`);
    }

    return { markdown: parts.join('\n\n') };
  }

  private sheetToHtml(sheet: any): string {
    const ref = sheet['!ref'];
    if (!ref) return '';

    const range = _xlsx.utils.decode_range(ref);
    const rows: string[] = [];

    for (let r = range.s.r; r <= range.e.r; r++) {
      const cells: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = _xlsx.utils.encode_cell({ r, c });
        const cell = sheet[addr];
        const val = cell && cell.v !== undefined ? String(cell.v) : '';
        cells.push(`<td>${this.escapeHtml(val)}</td>`);
      }
      const tag = r === range.s.r ? 'th' : 'td';
      const inner = cells.map(c => c.replace('<td>', `<${tag}>`).replace('</td>', `</${tag}>`)).join('');
      rows.push(`<tr>${inner}</tr>`);
    }

    return `<table>\n${rows.join('\n')}\n</table>`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
