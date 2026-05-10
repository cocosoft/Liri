import { BaseConverter } from '../engine/BaseConverter';
import type { ConversionResult, ConversionContext } from '../engine/types';
import { Logger } from '@modules/monitoring/logs/Logger';

const logger = new Logger();

export class CsvConverter extends BaseConverter {
  override readonly name = 'csv';
  override readonly supportedExtensions = ['.csv', '.tsv'];
  override readonly supportedMimeTypes = ['text/csv', 'text/tab-separated-values'];

  async convert(context: ConversionContext): Promise<ConversionResult> {
    const content = typeof context.content === 'string'
      ? context.content
      : context.content.toString('utf-8');

    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
      return { markdown: '*空表格*' };
    }

    const delimiter = context.fileInfo.extension === '.tsv' ? '\t' : this.detectDelimiter(lines[0]);
    const parsed = lines.map((line) => this.parseLine(line, delimiter));

    if (parsed.length === 0) {
      return { markdown: '*空表格*' };
    }

    const headers = parsed[0];
    const rows = parsed.slice(1);
    const columnWidths = this.calculateColumnWidths(headers, rows);

    const md = this.toMarkdownTable(headers, rows, columnWidths);

    return { markdown: md };
  }

  private detectDelimiter(headerLine: string): string {
    const commaCount = (headerLine.match(/,/g) || []).length;
    const tabCount = (headerLine.match(/\t/g) || []).length;
    const pipeCount = (headerLine.match(/\|/g) || []).length;

    if (tabCount > commaCount && tabCount > pipeCount) return '\t';
    if (pipeCount > commaCount && pipeCount > tabCount) return '|';
    return ',';
  }

  private parseLine(line: string, delimiter: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  private calculateColumnWidths(headers: string[], rows: string[][]): number[] {
    const widths = headers.map((h) => h.length);
    for (const row of rows) {
      for (let i = 0; i < row.length && i < widths.length; i++) {
        widths[i] = Math.max(widths[i], row[i].length);
      }
    }
    return widths;
  }

  private toMarkdownTable(headers: string[], rows: string[][], widths: number[]): string {
    const formatRow = (cells: string[]): string => {
      return `| ${cells.map((c, i) => c.padEnd(widths[i] || 0)).join(' | ')} |`;
    };

    const separator = `| ${widths.map((w) => '-'.repeat(Math.max(w, 3))).join(' | ')} |`;

    const lines: string[] = [];
    lines.push(formatRow(headers));
    lines.push(separator);

    for (const row of rows) {
      const paddedRow = [...row];
      while (paddedRow.length < headers.length) paddedRow.push('');
      lines.push(formatRow(paddedRow));
    }

    return lines.join('\n');
  }
}
